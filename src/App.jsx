import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import Papa from 'papaparse'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'

import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updateEmail,
  updatePassword,
  updateProfile,
} from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

import { auth, db } from './firebaseClient'
import { useToast } from './components/Toast.jsx'
import { Skeleton } from './ui/Skeleton.jsx'
import { formatCurrency, monthRangeISO, normalizeAmountString, parseAmountNumber } from './utils/format.js'

import './styles.css'

dayjs.extend(customParseFormat)

const DEFAULT_CATEGORIES = ['Groceries', 'Dining', 'Transport', 'Rent', 'Utilities', 'Shopping', 'Health', 'Other']

/* ---------------- Charts (lazy) ---------------- */
let chartRegistered = false
async function ensureChart() {
  if (chartRegistered) return
  const chartMod = await import('chart.js')
  const { Chart: ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement } = chartMod
  ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement)
  chartRegistered = true
}

const DoughnutChart = lazy(async () => {
  await ensureChart()
  const mod = await import('react-chartjs-2')
  return { default: mod.Doughnut }
})

const LineChart = lazy(async () => {
  await ensureChart()
  const mod = await import('react-chartjs-2')
  return { default: mod.Line }
})

/* ---------------- Utils / Hooks ---------------- */
function currencySymbol(curr) {
  switch (curr) {
    case 'USD': return '$'
    case 'GBP': return '£'
    case 'EGP': return 'E£'
    case 'AED': return 'د.إ'
    default: return '€'
  }
}

function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false) }), [])
  return { user, loading }
}

function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? JSON.parse(stored) : initialValue
    } catch {
      return initialValue
    }
  })
  const setAndStore = useCallback((val) => {
    setValue((prev) => {
      const next = typeof val === 'function' ? val(prev) : val
      localStorage.setItem(key, JSON.stringify(next))
      return next
    })
  }, [key])
  return [value, setAndStore]
}

function usePullToRefresh(onRefresh) {
  const ref = useRef(null)
  const [hintVisible, setHintVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let startY = null
    let triggered = false
    const handleTouchStart = (e) => {
      startY = el.scrollTop <= 0 ? e.touches[0].clientY : null
      triggered = false
    }
    const handleTouchMove = (e) => {
      if (startY == null) return
      const diff = e.touches[0].clientY - startY
      if (diff > 50) {
        setHintVisible(true)
        if (!triggered) {
          triggered = true
          navigator.vibrate?.(8)
          onRefresh?.()
        }
      } else {
        setHintVisible(false)
      }
    }
    const end = () => {
      startY = null
      setTimeout(() => setHintVisible(false), 150)
    }
    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: true })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [onRefresh])
  return { containerRef: ref, hintVisible }
}

/* ---------------- UI ---------------- */
function Header({ currency }) {
  return (
    <header className="app-header">
      <div className="brand">JinoFin</div>
      <div className="app-header-meta" aria-live="polite">
        <span>{currencySymbol(currency)} • {currency}</span>
      </div>
    </header>
  )
}

function Navbar({ tab, setTab }) {
  const items = [
    { key: 'New', label: 'New', icon: (<svg className="nav-icon" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M12 5v14M5 12h14" /></svg>) },
    { key: 'Overview', label: 'Overview', icon: (<svg className="nav-icon" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M4 7h16M4 12h16M4 17h16" /></svg>) },
    { key: 'Analytics', label: 'Analytics', icon: (<svg className="nav-icon" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M5 19V9m6 10V5m6 14V12" /></svg>) },
    { key: 'Settings', label: 'Settings', icon: (<svg className="nav-icon" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" fill="none"><path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" /><path d="M4 12h2l1-2 2-1-1-3 3-1 1 2h2l1-2 3 1-1 3 2 1 1 2h2" strokeLinecap="round" /></svg>) },
  ]
  return (
    <nav className="navbar" role="tablist" aria-label="Main navigation">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={tab === item.key}
          className={tab === item.key ? 'active' : ''}
          onClick={() => setTab(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

function SignInCard({ onContinue }) {
  const { pushToast } = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      navigator.vibrate?.(8)
      pushToast({ message: 'Welcome back!', variant: 'success' })
      onContinue?.()
    } catch (err) {
      pushToast({ message: err.message || 'Sign-in failed', variant: 'error', duration: 4200 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-card elevated" aria-live="polite">
      <h3 className="card-title">Sign in</h3>
      <div className="inline-field">
        <label htmlFor="signin-email">Email</label>
        <input id="signin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
      </div>
      <div className="inline-field">
        <label htmlFor="signin-password">Password</label>
        <input id="signin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </div>
      <button className="button" onClick={submit} disabled={loading}>{loading ? 'Signing in…' : 'Continue'}</button>
    </div>
  )
}

function SignUpSheet({ onClose }) {
  const { pushToast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const seedDefaults = async (uid) => {
    await setDoc(doc(db, 'households', uid), {
      categories: DEFAULT_CATEGORIES,
      currency: 'EUR',
      totalBudget: 2000,
      ...(name ? { name } : {}),
    })
    await setDoc(doc(db, 'households', uid, 'settings', 'budget'), {
      totalBudget: 2000,
      categoryBudgets: {},
      currency: 'EUR',
    })
  }

  const submit = async () => {
    setLoading(true)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      if (name) await updateProfile(cred.user, { displayName: name })
      await seedDefaults(cred.user.uid)
      pushToast({ message: 'Account created! Sign in to continue.', variant: 'success' })
      onClose?.()
    } catch (err) {
      pushToast({ message: err.message || 'Sign up failed', variant: 'error', duration: 4200 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">Create account</h3>
        <div className="inline-field">
          <label htmlFor="signup-name">Name (optional)</label>
          <input id="signup-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="inline-field">
          <label htmlFor="signup-email">Email</label>
          <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div className="inline-field">
          <label htmlFor="signup-password">Password</label>
          <input id="signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="row">
          <button className="button btn-outline" onClick={onClose}>Cancel</button>
          <button className="button" onClick={submit} disabled={loading}>{loading ? 'Creating…' : 'Sign up'}</button>
        </div>
      </div>
    </div>
  )
}

function HelpSheet({ onClose }) {
  const slides = [
    { title: 'Add income & expenses fast', text: 'Quick chips, smart budgets, locale-ready inputs.' },
    { title: 'Overview & analytics', text: 'Search, filter, and export with polished charts.' },
    { title: 'Offline-first PWA', text: 'Installs on iOS, refresh with pull gesture, works offline.' },
  ]
  const [index, setIndex] = useState(0)
  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">Why JinoFin?</h3>
        <div className="carousel" role="list">
          {slides.map((slide, idx) => (
            <div key={slide.title} className={`slide ${index === idx ? 'active' : ''}`} role="listitem">
              <div>
                <h4>{slide.title}</h4>
                <p className="small">{slide.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="dots" aria-hidden="true">
          {slides.map((_, idx) => <div key={idx} className={`dot ${idx === index ? 'active' : ''}`} />)}
        </div>
        <div className="row">
          <button className="button btn-outline" onClick={onClose}>Close</button>
          <button className="button" onClick={() => setIndex((index + 1) % slides.length)}>Next</button>
        </div>
      </div>
    </div>
  )
}

function Welcome({ onContinueSignIn, onShowSignUp, onShowHelp }) {
  return (
    <div className="app-shell">
      <Header currency="EUR" />
      <div className="app-content">
        <section className="app-card elevated">
          <h1>Welcome to JinoFin</h1>
          <p>Track spending fast, even offline.</p>
        </section>
        <SignInCard onContinue={onContinueSignIn} />
        <div className="row">
          <button className="button btn-outline" onClick={onShowSignUp}>Sign up</button>
          <button className="button btn-outline" onClick={onShowHelp}>Help</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- New: add entry ---------------- */
function NewTab({ uid, categories, currency, totalBudget, budgetsDocRef, refreshToken }) {
  const { pushToast } = useToast()
  const [type, setType] = useState('expense')
  const [category, setCategory] = useState(categories[0] || 'Other')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DDTHH:mm'))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [catBudgets, setCatBudgets] = useState({})
  const [leftInfo, setLeftInfo] = useState({ text: '', value: null, budget: 0, spent: 0, pending: 0 })

  useEffect(() => {
    setCategory((prev) => (categories.includes(prev) ? prev : categories[0] || 'Other'))
  }, [categories])

  useEffect(() => {
    if (!budgetsDocRef) return
    const unsub = onSnapshot(budgetsDocRef, (snap) => {
      if (snap.exists()) setCatBudgets(snap.data().categoryBudgets || {})
    })
    return () => unsub()
  }, [budgetsDocRef, refreshToken])

  useEffect(() => {
    if (type !== 'expense' || !uid || !category) {
      setLeftInfo((prev) => ({ ...prev, text: '', value: null, budget: 0, spent: 0, pending: 0 }))
      return
    }
    const monthKey = dayjs(date).format('YYYY-MM')
    const { start, end } = monthRangeISO(monthKey)
    const qRef = query(
      collection(db, 'households', uid, 'transactions'),
      where('date', '>=', start),
      where('date', '<=', end),
      where('type', '==', 'expense'),
      where('category', '==', category),
      orderBy('date', 'desc'),
    )
    const unsub = onSnapshot(qRef, (snap) => {
      let spent = 0
      snap.forEach((docSnap) => { spent += Number(docSnap.data().amount || 0) })
      const budget = Number(catBudgets[category] || 0)
      const pending = type === 'expense' ? (parseAmountNumber(amount) || 0) : 0
      const left = budget - spent - pending
      let text = ''
      if (budget > 0) {
        text = `${formatCurrency(left, currency)} left this month for ${category}`
      } else {
        text = 'No budget set for this category.'
      }
      setLeftInfo({ text, value: left, budget, spent, pending })
    })
    return () => unsub()
  }, [uid, category, date, amount, currency, catBudgets, type, refreshToken])

  const quickValues = useMemo(() => (type === 'expense' ? [5, 10, 20, 50, 75, 100, 150, 200] : [50, 100, 250, 500, 750, 1000]), [type])

  const applyChip = (chip) => {
    setAmount((prev) => {
      const base = parseAmountNumber(prev) || 0
      const next = base + chip
      return normalizeAmountString(next.toFixed(2))
    })
  }

  const save = async () => {
    const parsed = parseAmountNumber(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      pushToast({ message: 'Enter a valid amount', variant: 'error' })
      return
    }
    if (!category) {
      pushToast({ message: 'Select a category', variant: 'error' })
      return
    }
    setSaving(true)
    try {
      const iso = dayjs(date).toISOString()
      const payload = {
        type,
        amount: parsed,
        category,
        date: iso,
        note: note.trim(),
        createdAt: new Date().toISOString(),
      }
      await addDoc(collection(db, 'households', uid, 'transactions'), payload)
      setAmount('')
      setNote('')
      navigator.vibrate?.(10)
      pushToast({ message: `${type === 'expense' ? 'Expense' : 'Income'} saved`, variant: 'success' })
    } catch (err) {
      pushToast({ message: err.message || 'Failed to save transaction', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="app-card elevated">
      <div className="row">
        <button type="button" className={`button ${type === 'expense' ? '' : 'btn-muted'}`} onClick={() => setType('expense')}>Expense</button>
        <button type="button" className={`button ${type === 'income' ? '' : 'btn-muted'}`} onClick={() => setType('income')}>Income</button>
      </div>

      <div className="inline-field">
        <label>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="inline-field">
        <label>Amount</label>
        <div className="quick-chips">
          {quickValues.map((chip) => (
            <button key={chip} type="button" className="quick-chip" onClick={() => applyChip(chip)}>
              {formatCurrency(chip, currency, { minimumFractionDigits: chip >= 100 ? 0 : 2 })}
            </button>
          ))}
        </div>
        <input
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(normalizeAmountString(e.target.value))}
          onBlur={(e) => setAmount(normalizeAmountString(e.target.value))}
        />
      </div>

      <div className="inline-field">
        <label>Date &amp; time</label>
        <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="inline-field">
        <label>Note (optional)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </div>

      {type === 'expense' && (
        <details className="foldable" open={leftInfo.budget > 0}>
          <summary className="toggle-row">
            <span>Budget insight</span>
            {leftInfo.budget > 0 ? (
              <span className={leftInfo.value >= 0 ? 'amount-pos' : 'amount-neg'}>
                {formatCurrency(leftInfo.value, currency)}
              </span>
            ) : (
              <span className="small muted">No budget set</span>
            )}
          </summary>
          <div className="foldable-content">
            <div className="flex-between"><span>Monthly budget</span><span>{formatCurrency(leftInfo.budget || 0, currency)}</span></div>
            <div className="flex-between"><span>Spent so far</span><span>{formatCurrency(leftInfo.spent || 0, currency)}</span></div>
            <div className="flex-between"><span>This entry</span><span>{formatCurrency(parseAmountNumber(amount) || 0, currency)}</span></div>
            <div className="flex-between"><span>Left after save</span><span className={leftInfo.value >= 0 ? 'amount-pos' : 'amount-neg'}>{formatCurrency(leftInfo.value || 0, currency)}</span></div>
          </div>
        </details>
      )}

      <button className="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save transaction'}</button>
      <p className="small muted">Overall monthly budget: {formatCurrency(totalBudget || 0, currency)}</p>
    </section>
  )
}

/* ---------------- Overview ---------------- */
function OverviewTab({ uid, categories, currency, refreshToken }) {
  const { pushToast } = useToast()
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'))
  const [typeFilter, setTypeFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const fileRef = useRef(null)
  const [csvPreview, setCsvPreview] = useState(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!uid) return undefined
    setLoading(true)
    const { start, end } = monthRangeISO(monthKey)
    const qRef = query(
      collection(db, 'households', uid, 'transactions'),
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date', 'desc'),
    )
    const unsub = onSnapshot(qRef, (snap) => {
      const list = []
      snap.forEach((docSnap) => list.push({ id: docSnap.id, ...docSnap.data() }))
      setTransactions(list)
      setLoading(false)
    })
    return () => unsub()
  }, [uid, monthKey, refreshToken])

  const months = useMemo(() => Array.from({ length: 6 }, (_, idx) => dayjs().subtract(idx, 'month').format('YYYY-MM')), [])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return transactions.filter((tx) => {
      if (typeFilter !== 'All' && tx.type !== typeFilter.toLowerCase()) return false
      if (categoryFilter !== 'All' && tx.category !== categoryFilter) return false
      if (!needle) return true
      return [tx.category, tx.note, dayjs(tx.date).format('MMM D YYYY HH:mm')]
        .some((val) => val?.toString().toLowerCase().includes(needle))
    })
  }, [transactions, typeFilter, categoryFilter, search])

  const totals = useMemo(() => {
    return filtered.reduce((acc, tx) => {
      const val = Number(tx.amount || 0)
      if (tx.type === 'income') acc.income += val
      else acc.expense += val
      return acc
    }, { income: 0, expense: 0 })
  }, [filtered])

  const net = totals.income - totals.expense

  const parseDateToISO = (val) => {
    if (!val && val !== 0) return null
    const candidates = ['YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DDTHH:mm', 'YYYY-MM-DD HH:mm', 'DD.MM.YYYY']
    for (const fmt of candidates) {
      const d = dayjs(val, fmt, true)
      if (d.isValid()) return d.toISOString()
    }
    const d2 = dayjs(val)
    return d2.isValid() ? d2.toISOString() : null
  }

  const handleImportClick = () => fileRef.current?.click()

  const onFileSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const rows = results.data || []
          if (!rows.length) {
            pushToast({ message: 'No rows found in CSV', variant: 'error' })
            return
          }
          const normalized = rows.map((raw) => {
            const get = (key) => raw[key] ?? raw[key?.toLowerCase?.()] ?? raw[key?.toUpperCase?.()]
            const rawType = (get('type') || '').toString().trim().toLowerCase()
            const type = rawType === 'income' ? 'income' : 'expense'
            const amount = parseAmountNumber(get('amount'))
            const category = (get('category') || 'Other').toString().trim() || 'Other'
            const dateISO = parseDateToISO(get('date'))
            const note = (get('note') || '').toString().trim()
            const valid = Number.isFinite(amount) && amount > 0 && !!dateISO
            return { type, amount, category, date: dateISO, note, valid }
          })
          const newCategories = new Set(normalized.filter((row) => row.category).map((row) => row.category))
          setCsvPreview({ rows: normalized, total: rows.length, newCategories })
        } catch (err) {
          pushToast({ message: err.message || 'Failed to parse CSV', variant: 'error' })
        }
      },
      error: (error) => {
        pushToast({ message: error.message || 'Failed to parse CSV', variant: 'error' })
      },
    })
  }

  const confirmImport = async () => {
    if (!csvPreview) return
    setImporting(true)
    try {
      const validRows = csvPreview.rows.filter((row) => row.valid)
      if (!validRows.length) {
        pushToast({ message: 'No valid rows to import', variant: 'error' })
        setImporting(false)
        return
      }
      const batch = writeBatch(db)
      const colRef = collection(db, 'households', uid, 'transactions')
      validRows.forEach((row) => {
        const ref = doc(colRef)
        batch.set(ref, {
          type: row.type,
          amount: row.amount,
          category: row.category,
          date: row.date,
          note: row.note,
          createdAt: new Date().toISOString(),
        })
      })
      await batch.commit()
      const catsToAdd = Array.from(csvPreview.newCategories || []).filter((c) => c && !categories.includes(c))
      if (catsToAdd.length) {
        await setDoc(doc(db, 'households', uid), {
          categories: Array.from(new Set([...categories, ...catsToAdd])),
        }, { merge: true })
      }
      pushToast({ message: `Imported ${validRows.length} row${validRows.length === 1 ? '' : 's'}`, variant: 'success' })
      setCsvPreview(null)
      fileRef.current.value = ''
    } catch (err) {
      pushToast({ message: err.message || 'Import failed', variant: 'error' })
    } finally {
      setImporting(false)
    }
  }

  const cancelPreview = () => {
    setCsvPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const onDelete = async (tx) => {
    try {
      await deleteDoc(doc(db, 'households', uid, 'transactions', tx.id))
      pushToast({
        message: 'Transaction deleted',
        variant: 'success',
        action: {
          label: 'Undo',
          onClick: async () => {
            await setDoc(doc(db, 'households', uid, 'transactions', tx.id), {
              type: tx.type,
              amount: tx.amount,
              category: tx.category,
              date: tx.date,
              note: tx.note,
              createdAt: tx.createdAt || new Date().toISOString(),
            })
          },
        },
      })
    } catch (err) {
      pushToast({ message: err.message || 'Failed to delete', variant: 'error' })
    }
  }

  return (
    <>
      <section className="app-card">
        <div className="filters">
          <div className="inline-field">
            <label>Month</label>
            <select value={monthKey} onChange={(e) => setMonthKey(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="inline-field">
            <label>Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option>All</option>
              <option>Income</option>
              <option>Expense</option>
            </select>
          </div>
          <div className="inline-field">
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option>All</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="inline-field">
            <label>Search</label>
            <input placeholder="Note or category" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="row">
          <button className="button btn-outline" type="button" onClick={handleImportClick}>Import CSV</button>
          <button className="button btn-outline" type="button" onClick={() => {
            const csv = Papa.unparse(transactions.map((t) => ({
              type: t.type,
              amount: t.amount,
              category: t.category,
              date: t.date,
              note: t.note,
            })))
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `jinofin-${dayjs().format('YYYYMMDD-HHmm')}.csv`
            a.click()
            URL.revokeObjectURL(url)
            const el = fileRef.current; if (el) el.value = ''
            pushToast({ message: 'Exported CSV', variant: 'success' })
          }}>Export CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onFileSelected} />
        </div>
      </section>

      <section className="app-card">
        <div className="stat-grid">
          <div className="stat-card">
            <span className="small muted">Income</span>
            <strong>{formatCurrency(totals.income, currency)}</strong>
          </div>
          <div className="stat-card">
            <span className="small muted">Expenses</span>
            <strong>{formatCurrency(totals.expense, currency)}</strong>
          </div>
          <div className="stat-card">
            <span className="small muted">Net</span>
            <strong className={net >= 0 ? 'amount-pos' : 'amount-neg'}>{formatCurrency(net, currency)}</strong>
          </div>
        </div>
      </section>

      <section className="app-card">
        <div className="card-header">
          <h3 className="card-title">Transactions</h3>
          <span className="small muted">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
        </div>
        {loading ? (
          <Skeleton style={{ height: 120 }} />
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M4 7h16v11H4z" />
              <path d="M9 3h6v4H9z" />
              <path d="M9 12h6" />
              <path d="M9 16h6" />
            </svg>
            <h3>No transactions yet</h3>
            <p className="small">Add your first expense or income from the New tab.</p>
          </div>
        ) : (
          <div className="list">
            {filtered.map((tx) => (
              <div key={tx.id} className="list-item">
                <div>
                  <strong>{tx.category}</strong>
                  <div className="small muted">{dayjs(tx.date).format('MMM D, YYYY • HH:mm')}</div>
                  {tx.note && <div className="small">{tx.note}</div>}
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div className={tx.type === 'income' ? 'amount-pos' : 'amount-neg'}>
                    {tx.type === 'income' ? '+' : '−'} {formatCurrency(Number(tx.amount || 0), currency)}
                  </div>
                  <button type="button" onClick={() => onDelete(tx)} style={{ background: 'transparent', border: 'none', color: 'inherit', padding: 4 }} aria-label="Delete">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {csvPreview && (
        <div className="overlay centered" onClick={cancelPreview}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="card-title">Import preview</h3>
            <p className="helper-text">Showing first {Math.min(csvPreview.rows.length, 8)} of {csvPreview.total} rows.</p>
            <table className="table-preview">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Category</th>
                  <th>Date</th>
                  <th>Note</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {csvPreview.rows.slice(0, 8).map((row, idx) => (
                  <tr key={idx}>
                    <td>{row.type}</td>
                    <td>{formatCurrency(row.amount, currency)}</td>
                    <td>{row.category}</td>
                    <td>{row.date ? dayjs(row.date).format('YYYY-MM-DD HH:mm') : '—'}</td>
                    <td>{row.note}</td>
                    <td>{row.valid ? 'Ready' : 'Skipped'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="helper-text">{csvPreview.rows.filter((r) => r.valid).length} valid row{csvPreview.rows.filter((r) => r.valid).length === 1 ? '' : 's'} will be imported.</p>
            <div className="row">
              <button className="button btn-outline" type="button" onClick={cancelPreview}>Cancel</button>
              <button className="button" type="button" onClick={confirmImport} disabled={importing}>{importing ? 'Importing…' : 'Import'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------------- Analytics ---------------- */
function AnalyticsTab({ uid, categories, currency, totalBudget, refreshToken }) {
  const { pushToast } = useToast()
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'))
  const [range, setRange] = useState('this')
  const [transactions, setTransactions] = useState([])
  const [catBudgets, setCatBudgets] = useState({})
  const [showLine, setShowLine] = useState(false)
  const [showLeft, setShowLeft] = useState(false)
  const analyticsRef = useRef(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) return undefined
    const budgetsRef = doc(db, 'households', uid, 'settings', 'budget')
    const unsub = onSnapshot(budgetsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setCatBudgets(data.categoryBudgets || {})
      }
    })
    return () => unsub()
  }, [uid, refreshToken])

  useEffect(() => {
    if (!uid) return undefined
    setLoading(true)
    let start
    let end
    if (range === 'this') {
      start = dayjs(monthKey + '-01').startOf('day')
      end = dayjs(monthKey).endOf('month').endOf('day')
    } else {
      end = dayjs().endOf('month').endOf('day')
      start = dayjs().subtract(5, 'month').startOf('month')
    }
    const qRef = query(
      collection(db, 'households', uid, 'transactions'),
      where('date', '>=', start.toISOString()),
      where('date', '<=', end.toISOString()),
      orderBy('date', 'desc'),
    )
    const unsub = onSnapshot(qRef, (snap) => {
      const list = []
      snap.forEach((docSnap) => list.push({ id: docSnap.id, ...docSnap.data() }))
      setTransactions(list)
      setLoading(false)
    })
    return () => unsub()
  }, [uid, monthKey, range, refreshToken])

  const totals = useMemo(() => {
    return transactions.reduce((acc, tx) => {
      const val = Number(tx.amount || 0)
      if (tx.type === 'income') acc.income += val
      if (tx.type === 'expense') acc.expense += val
      return acc
    }, { income: 0, expense: 0 })
  }, [transactions])

  const expenseByCat = useMemo(() => {
    const acc = {}
    let total = 0
    transactions.forEach((tx) => {
      if (tx.type !== 'expense') return
      acc[tx.category] = (acc[tx.category] || 0) + Number(tx.amount || 0)
      total += Number(tx.amount || 0)
    })
    return { acc, total }
  }, [transactions])

  const byMonth = useMemo(() => {
    const acc = {}
    transactions.forEach((tx) => {
      const key = dayjs(tx.date).format('YYYY-MM')
      if (!acc[key]) acc[key] = { income: 0, expense: 0 }
      acc[key][tx.type] += Number(tx.amount || 0)
    })
    const labels = Object.keys(acc).sort()
    return {
      labels,
      income: labels.map((l) => acc[l].income),
      expense: labels.map((l) => acc[l].expense),
    }
  }, [transactions])

  const expensesThisMonthByCat = useMemo(() => {
    const map = {}
    transactions.forEach((tx) => {
      if (tx.type !== 'expense') return
      if (dayjs(tx.date).format('YYYY-MM') !== monthKey) return
      map[tx.category] = (map[tx.category] || 0) + Number(tx.amount || 0)
    })
    return map
  }, [transactions, monthKey])

  const leftByCat = useMemo(() => {
    const result = {}
    const catSet = new Set([...Object.keys(catBudgets || {}), ...categories])
    catSet.forEach((cat) => {
      const budget = Number((catBudgets || {})[cat] || 0)
      if (budget <= 0) return
      const spent = Number(expensesThisMonthByCat[cat] || 0)
      result[cat] = budget - spent
    })
    return result
  }, [catBudgets, expensesThisMonthByCat, categories])

  const doughnutData = useMemo(() => {
    const labels = Object.keys(expenseByCat.acc)
    return {
      labels,
      datasets: [
        {
          data: Object.values(expenseByCat.acc),
          backgroundColor: labels.map((_, idx) => ['#2563eb', '#22c55e', '#ef4444', '#eab308', '#06b6d4', '#a855f7', '#f97316', '#14b8a6'][idx % 8]),
          borderWidth: 0,
        },
      ],
    }
  }, [expenseByCat])

  const doughnutOptions = useMemo(() => ({
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = ctx.raw || 0
            const pct = expenseByCat.total ? ((value / expenseByCat.total) * 100).toFixed(1) : 0
            return `${ctx.label}: ${formatCurrency(value, currency)} • ${pct}%`
          },
        },
      },
      legend: { position: 'bottom' },
    },
    maintainAspectRatio: false,
  }), [expenseByCat, currency])

  const exportCSV = () => {
    const csv = Papa.unparse(transactions.map((t) => ({ type: t.type, amount: t.amount, category: t.category, date: t.date, note: t.note })))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `jinofin-analytics-${dayjs().format('YYYYMMDD-HHmm')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    pushToast({ message: 'Exported CSV', variant: 'success' })
  }

  const exportPDF = async () => {
    if (!analyticsRef.current) return
    const node = analyticsRef.current
    const canvas = await html2canvas(node, { scale: 2 })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
    const w = canvas.width * ratio
    const h = canvas.height * ratio
    pdf.addImage(imgData, 'PNG', (pageWidth - w) / 2, 10, w, h)
    pdf.save(`jinofin-analytics-${dayjs().format('YYYYMMDD-HHmm')}.pdf`)
    pushToast({ message: 'Exported PDF', variant: 'success' })
  }

  return (
    <>
      <section className="app-card">
        <div className="badge-row">
          {Array.from({ length: 6 }, (_, idx) => dayjs().subtract(idx, 'month').format('YYYY-MM')).map((m) => (
            <button key={m} type="button" className={`badge ${m === monthKey ? 'active' : ''}`} onClick={() => setMonthKey(m)}>{m}</button>
          ))}
        </div>
        <div className="row">
          <button className={`button ${range === 'this' ? '' : 'btn-outline'}`} type="button" onClick={() => setRange('this')}>This month</button>
          <button className={`button ${range === 'last' ? '' : 'btn-outline'}`} type="button" onClick={() => setRange('last')}>Last 6 months</button>
        </div>
      </section>

      <section className="app-card" ref={analyticsRef}>
        <div className="card-header">
          <h3 className="card-title">Spending insights</h3>
          <span className="small muted">{transactions.length} records</span>
        </div>
        {loading ? (
          <Skeleton style={{ height: 220 }} />
        ) : expenseByCat.total === 0 ? (
          <p className="small muted">No expenses in the selected range yet.</p>
        ) : (
          <Suspense fallback={<Skeleton style={{ height: 220 }} />}>
            <div className="chart-shell">
              <DoughnutChart data={doughnutData} options={doughnutOptions} />
            </div>
          </Suspense>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <div className="inline-field" style={{ flex: 1 }}>
            <label>Income vs expense</label>
            <button className="button btn-outline" type="button" onClick={() => setShowLine((v) => !v)}>{showLine ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        {showLine && (
          <Suspense fallback={<Skeleton style={{ height: 200, marginTop: 12 }} />}>
            <div style={{ height: 220, marginTop: 12 }}>
              <LineChart data={{
                labels: byMonth.labels,
                datasets: [
                  { label: 'Income', data: byMonth.income, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.2)', tension: 0.35, fill: false },
                  { label: 'Expense', data: byMonth.expense, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.2)', tension: 0.35, fill: false },
                ],
              }} options={{ maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }} />
            </div>
          </Suspense>
        )}

        <details className="foldable" open={showLeft} style={{ marginTop: 16 }}>
          <summary className="toggle-row" onClick={(e) => { e.preventDefault(); setShowLeft((v) => !v) }}>
            <span>Left to spend this month</span>
            <span className="small muted">{formatCurrency(Object.values(leftByCat).reduce((acc, v) => acc + v, 0), currency)}</span>
          </summary>
          {showLeft && (
            <div className="foldable-content">
              {Object.keys(leftByCat).length === 0 ? (
                <p className="small muted">Set category budgets in Settings to track remaining spend.</p>
              ) : (
                Object.entries(leftByCat).sort(([a], [b]) => a.localeCompare(b)).map(([cat, left]) => (
                  <div key={cat} className="bar-row">
                    <span>{cat}</span>
                    <div className="bar">
                      <div className="fill" style={{ width: `${Math.max(0, Math.min(100, (left / (catBudgets[cat] || 1)) * 100))}%` }} />
                    </div>
                    <span className={left >= 0 ? 'amount-pos' : 'amount-neg'}>{formatCurrency(left, currency)}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </details>
      </section>

      <section className="app-card">
        <div className="stat-grid">
          <div className="stat-card">
            <span className="small muted">Income</span>
            <strong>{formatCurrency(totals.income, currency)}</strong>
          </div>
          <div className="stat-card">
            <span className="small muted">Expenses</span>
            <strong>{formatCurrency(totals.expense, currency)}</strong>
          </div>
          <div className="stat-card">
            <span className="small muted">Net</span>
            <strong className={totals.income - totals.expense >= 0 ? 'amount-pos' : 'amount-neg'}>{formatCurrency(totals.income - totals.expense, currency)}</strong>
          </div>
          <div className="stat-card">
            <span className="small muted">Budget</span>
            <strong>{formatCurrency(totalBudget || 0, currency)}</strong>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="button" type="button" onClick={exportCSV}>Export CSV</button>
          <button className="button btn-outline" type="button" onClick={exportPDF}>Export PDF</button>
        </div>
      </section>
    </>
  )
}

/* ---------------- Settings ---------------- */
function SettingsTab({ uid, currency, setCurrency, categories, setCategories, totalBudget, setTotalBudget, refreshToken }) {
  const { pushToast } = useToast()
  const [theme, setTheme] = useLocalStorageState('theme', 'dark')
  const [localCurrency, setLocalCurrency] = useState(currency)
  const [localCategories, setLocalCategories] = useState(categories)
  const [catBudgets, setCatBudgets] = useState({})
  const [displayName, setDisplayName] = useState(auth.currentUser?.displayName || '')
  const [email, setEmail] = useState(auth.currentUser?.email || '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [savingMain, setSavingMain] = useState(false)
  const [savingAccount, setSavingAccount] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => { setLocalCurrency(currency) }, [currency])
  useEffect(() => { setLocalCategories(categories) }, [categories])

  useEffect(() => {
    if (!uid) return undefined
    const budgetsRef = doc(db, 'households', uid, 'settings', 'budget')
    const unsub = onSnapshot(budgetsRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setCatBudgets(data.categoryBudgets || {})
        if (data.totalBudget != null) setTotalBudget(data.totalBudget)
        if (data.currency) setLocalCurrency(data.currency)
      }
    })
    return () => unsub()
  }, [uid, refreshToken, setTotalBudget])

  const addCategory = () => {
    const name = window.prompt('New category name')?.trim()
    if (!name) return
    if (localCategories.includes(name)) {
      pushToast({ message: 'Category already exists', variant: 'error' })
      return
    }
    setLocalCategories((prev) => [...prev, name])
    setCatBudgets((prev) => ({ ...prev, [name]: 0 }))
  }

  const setCatBudget = (cat, value) => {
    setCatBudgets((prev) => ({ ...prev, [cat]: Number(value) || 0 }))
  }

  const removeCategory = (cat) => {
    if (!window.confirm(`Remove category "${cat}"? Existing transactions keep their category.`)) return
    setLocalCategories((prev) => prev.filter((c) => c !== cat))
    setCatBudgets((prev) => {
      const next = { ...prev }
      delete next[cat]
      return next
    })
  }

  const saveMain = async () => {
    setSavingMain(true)
    try {
      const cleanedBudgets = Object.fromEntries(Object.entries(catBudgets).filter(([, val]) => Number(val) > 0).map(([k, v]) => [k, Number(v)]))
      await setDoc(doc(db, 'households', uid), {
        currency: localCurrency,
        categories: localCategories,
        totalBudget,
      }, { merge: true })
      await setDoc(doc(db, 'households', uid, 'settings', 'budget'), {
        totalBudget,
        categoryBudgets: cleanedBudgets,
        currency: localCurrency,
      }, { merge: true })
      setCurrency(localCurrency)
      setCategories(localCategories)
      pushToast({ message: 'Settings saved', variant: 'success' })
    } catch (err) {
      pushToast({ message: err.message || 'Failed to save settings', variant: 'error' })
    } finally {
      setSavingMain(false)
    }
  }

  const saveAccount = async () => {
    setSavingAccount(true)
    try {
      const user = auth.currentUser
      if (!user) throw new Error('No authenticated user')
      const needsReauth = (email && email !== user.email) || Boolean(newPw)
      if (needsReauth) {
        if (!currentPw) throw new Error('Enter your current password to update email or password.')
        const credential = EmailAuthProvider.credential(user.email, currentPw)
        await reauthenticateWithCredential(user, credential)
      }
      if (email && email !== user.email) {
        await updateEmail(user, email)
      }
      if (newPw) {
        await updatePassword(user, newPw)
      }
      if (displayName !== user.displayName) {
        await updateProfile(user, { displayName })
      }
      pushToast({ message: 'Account updated', variant: 'success' })
      setCurrentPw('')
      setNewPw('')
    } catch (err) {
      pushToast({ message: err.message || 'Failed to update account', variant: 'error' })
    } finally {
      setSavingAccount(false)
    }
  }

  return (
    <>
      <section className="app-card">
        <h3 className="card-title">Theme</h3>
        <div className="row">
          <button className={`button ${theme === 'dark' ? '' : 'btn-outline'}`} type="button" onClick={() => setTheme('dark')}>Dark</button>
          <button className={`button ${theme === 'light' ? '' : 'btn-outline'}`} type="button" onClick={() => setTheme('light')}>Light</button>
          <button className={`button ${theme === 'playful' ? '' : 'btn-outline'}`} type="button" onClick={() => setTheme('playful')}>Playful</button>
        </div>
      </section>

      <section className="app-card">
        <h3 className="card-title">Currency</h3>
        <select value={localCurrency} onChange={(e) => setLocalCurrency(e.target.value)}>
          <option value="EUR">EUR</option>
          <option value="USD">USD</option>
          <option value="GBP">GBP</option>
          <option value="EGP">EGP</option>
          <option value="AED">AED</option>
        </select>
      </section>

      <section className="app-card">
        <h3 className="card-title">Budgets</h3>
        <div className="inline-field">
          <label>Total monthly budget</label>
          <input type="number" value={totalBudget} onChange={(e) => setTotalBudget(Number(e.target.value) || 0)} />
        </div>
        <div className="list">
          {localCategories.map((cat) => (
            <div key={cat} className="list-item">
              <div>
                <strong>{cat}</strong>
                <div className="small muted">{formatCurrency(catBudgets[cat] || 0, localCurrency)}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input type="number" value={catBudgets[cat] ?? ''} onChange={(e) => setCatBudget(cat, e.target.value)} placeholder="0" style={{ width: '120px' }} />
                <button type="button" className="button btn-outline" onClick={() => removeCategory(cat)} aria-label={`Remove ${cat}`}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <div className="row">
          <button className="button btn-outline" type="button" onClick={addCategory}>Add category</button>
          <button className="button" type="button" onClick={saveMain} disabled={savingMain}>{savingMain ? 'Saving…' : 'Save budgets'}</button>
        </div>
      </section>

      <section className="app-card">
        <h3 className="card-title">Account</h3>
        <div className="inline-field">
          <label>Display name</label>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name" />
        </div>
        <div className="inline-field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        </div>
        <div className="inline-field">
          <label>Current password (required for changes)</label>
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" />
        </div>
        <div className="inline-field">
          <label>New password</label>
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password" />
        </div>
        <div className="row">
          <button className="button btn-outline" type="button" onClick={() => signOut(auth)}>Sign out</button>
          <button className="button" type="button" onClick={saveAccount} disabled={savingAccount}>{savingAccount ? 'Saving…' : 'Save account'}</button>
        </div>
      </section>
    </>
  )
}

/* ---------------- App ---------------- */
export default function App() {
  const { pushToast } = useToast()
  const { user, loading } = useAuth()
  const [showSignUp, setShowSignUp] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [tab, setTab] = useState('New')
  const [currency, setCurrency] = useState('EUR')
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [totalBudget, setTotalBudget] = useState(2000)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!user) return undefined
    const unsub = onSnapshot(doc(db, 'households', user.uid), (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setCurrency(data.currency || 'EUR')
        if (Array.isArray(data.categories) && data.categories.length) {
          setCategories(data.categories)
        } else {
          setCategories(DEFAULT_CATEGORIES)
        }
        if (data.totalBudget != null) setTotalBudget(data.totalBudget)
      }
    })
    return () => unsub()
  }, [user])

  const handleRefresh = useCallback(() => {
    if (!user) return
    setRefreshToken((token) => token + 1)
    pushToast({ message: 'Refreshing data…', variant: 'success', duration: 1600 })
  }, [user, pushToast])

  const { containerRef, hintVisible } = usePullToRefresh(handleRefresh)

  if (loading) {
    return (
      <div className="app-shell">
        <Header currency={currency} />
        <main className="app-content">
          <Skeleton style={{ height: 140 }} />
        </main>
      </div>
    )
  }

  if (!user) {
    return (
      <>
        <Welcome onContinueSignIn={() => {}} onShowSignUp={() => setShowSignUp(true)} onShowHelp={() => setShowHelp(true)} />
        {showSignUp && <SignUpSheet onClose={() => setShowSignUp(false)} />}
        {showHelp && <HelpSheet onClose={() => setShowHelp(false)} />}
      </>
    )
  }

  const budgetsDocRef = doc(db, 'households', user.uid, 'settings', 'budget')

  return (
    <div className="app-shell">
      <Header currency={currency} />
      <main className="app-content" ref={containerRef}>
        <div className={`pull-refresh-hint ${hintVisible ? 'visible' : ''}`}>Release to refresh</div>
        {tab === 'New' && (
          <NewTab
            uid={user.uid}
            categories={categories}
            currency={currency}
            totalBudget={totalBudget}
            budgetsDocRef={budgetsDocRef}
            refreshToken={refreshToken}
          />
        )}
        {tab === 'Overview' && (
          <OverviewTab
            uid={user.uid}
            categories={categories}
            currency={currency}
            refreshToken={refreshToken}
          />
        )}
        {tab === 'Analytics' && (
          <AnalyticsTab
            uid={user.uid}
            categories={categories}
            currency={currency}
            totalBudget={totalBudget}
            refreshToken={refreshToken}
          />
        )}
        {tab === 'Settings' && (
          <SettingsTab
            uid={user.uid}
            currency={currency}
            setCurrency={setCurrency}
            categories={categories}
            setCategories={setCategories}
            totalBudget={totalBudget}
            setTotalBudget={setTotalBudget}
            refreshToken={refreshToken}
          />
        )}
      </main>
      <Navbar tab={tab} setTab={setTab} />
    </div>
  )
}
