import React, { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import Papa from 'papaparse'

import { initializeApp } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  updateEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from 'firebase/auth'
import {
  getFirestore,
  doc, setDoc, deleteDoc,
  collection, addDoc,
  query, where, orderBy, onSnapshot
} from 'firebase/firestore'

import {
  Chart as ChartJS,
  ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement
} from 'chart.js'
import { Doughnut, Line } from 'react-chartjs-2'

import { firebaseConfig } from './firebaseConfig'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement)

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

const DEFAULT_CATEGORIES = ['Groceries','Dining','Transport','Rent','Utilities','Shopping','Health','Other']

function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false) }), [])
  return { user, loading }
}

function currencySymbol(curr) {
  switch (curr) {
    case 'USD': return '$'
    case 'GBP': return '£'
    case 'EGP': return 'E£'
    case 'AED': return 'د.إ'
    default: return '€'
  }
}

/* ---------------- UI primitives ---------------- */
function Header({ currency }) {
  return (
    <div className="header">
      <div className="brand">JinoFin</div>
      <div className="currency">{currencySymbol(currency)} • {currency}</div>
    </div>
  )
}

function Navbar({ tab, setTab }) {
  const items = [
    { key: 'New', label: 'New', icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
    )},
    { key: 'Overview', label: 'Overview', icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    )},
    { key: 'Analytics', label: 'Analytics', icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19V5m5 14V10m5 9V7m5 12V3" />
      </svg>
    )},
    { key: 'Settings', label: 'Settings', icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6l-.09.11a2 2 0 1 1-3.18 0l-.09-.11a1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82-.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1l-.11-.09a2 2 0 1 1 0-3.18l.11-.09a1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.6-1l-.11-.09a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6l.09-.11a2 2 0 1 1 3.18 0l.09.11a1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.26.3.47.64.6 1l.11.09a2 2 0 1 1 0 3.18l-.11.09c-.13.36-.34.7-.6 1z" />
      </svg>
    )},
  ]
  return (
    <nav className="navbar" role="tablist">
      {items.map(it => (
        <button key={it.key} className={'nav-btn ' + (tab===it.key ? 'active':'')} onClick={() => setTab(it.key)} role="tab" aria-selected={tab===it.key}>
          {it.icon}
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  )
}

/* ---------------- Auth: Welcome / Sign In / Sign Up / Help ---------------- */
function Welcome({ onContinueSignIn, onShowSignUp, onShowHelp }) {
  return (
    <div className="app">
      <Header currency={'EUR'} />
      <div className="content">
        <div className="hero">
          <div className="hero-logo">J</div>
          <h1>Welcome to JinoFin</h1>
          <p>Track spending fast. Budgets, analytics, and exports—on your phone.</p>
        </div>

        <SignInCard onContinue={onContinueSignIn} />

        <div className="row">
          <button className="button btn-outline" onClick={onShowSignUp}>Sign up</button>
          <button className="button btn-outline" onClick={onShowHelp}>Help</button>
        </div>
      </div>
    </div>
  )
}

function SignInCard({ onContinue }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handle = async () => {
    setError('')
    try {
      // Sign-in ONLY. (Creation is handled in Sign Up form.)
      await signInWithEmailAndPassword(auth, email, password)
      onContinue && onContinue()
    } catch (e) {
      if (e.code === 'auth/invalid-credential') {
        setError('Incorrect email or password.')
      } else if (e.code === 'auth/invalid-email') {
        setError('Invalid email.')
      } else if (e.code === 'auth/operation-not-allowed') {
        setError('Email/password sign-in is disabled in Firebase Console.')
      } else {
        setError(e.message || 'Sign-in failed.')
      }
    }
  }

  return (
    <div className="card">
      <h3>Sign in</h3>
      <input className="input" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
      <div style={{ height: 8 }} />
      <input className="input" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
      <div style={{ height: 12 }} />
      <button className="button" onClick={handle}>Continue</button>
      {error && <p className="small" style={{color:'var(--danger)'}}>{error}</p>}
    </div>
  )
}

function SignUpSheet({ onClose }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const seedDefaults = async (uid) => {
    await setDoc(doc(db, 'households', uid), {
      categories: DEFAULT_CATEGORIES,
      currency: 'EUR',
      totalBudget: 2000,
      ...(name ? { name } : {})
    })
    await setDoc(doc(db, 'households', uid, 'settings', 'budget'), {
      totalBudget: 2000, categoryBudgets: {}, currency: 'EUR'
    })
  }

  const submit = async () => {
    setError('')
    if (!email || !password) { setError('Email and password required.'); return }
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      if (name) {
        await updateProfile(cred.user, { displayName: name })
      }
      await seedDefaults(cred.user.uid)
      onClose && onClose()
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') setError('Email already in use. Try signing in.')
      else if (e.code === 'auth/invalid-email') setError('Invalid email.')
      else if (e.code === 'auth/weak-password') setError('Weak password. Use 6+ characters.')
      else setError(e.message || 'Sign-up failed.')
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()}>
        <h3>Create account</h3>
        <input className="input" placeholder="Name (optional)" value={name} onChange={e=>setName(e.target.value)} />
        <div style={{height:8}} />
        <input className="input" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
        <div style={{height:8}} />
        <input className="input" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <div style={{height:12}} />
        <div className="row">
          <button className="button btn-outline" onClick={onClose}>Cancel</button>
          <button className="button" onClick={submit}>Sign up</button>
        </div>
      </div>
    </div>
  )
}

function HelpSheet({ onClose }) {
  const [i, setI] = useState(0)
  const slides = [
    { title: 'Add income & expenses fast', text: 'Big buttons. Category, amount, date, note. One tap to save.' },
    { title: 'Budgets & “left this month”', text: 'Set per-category budgets and see remaining instantly.' },
    { title: 'Overview, Analytics & Export', text: 'Filter months, view charts, and export CSV/PDF. Themes & currencies too.' },
  ]
  const next = () => setI((i+1) % slides.length)

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={e=>e.stopPropagation()}>
        <h3>Welcome to JinoFin</h3>
        <div className="carousel">
          {slides.map((s,idx)=>(
            <div key={idx} className={'slide ' + (i===idx?'active':'')}>
              <div>
                <h4 style={{margin:'4px 0 6px'}}>{s.title}</h4>
                <p className="small">{s.text}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="dots">
          {slides.map((_,idx)=><div key={idx} className={'dot ' + (i===idx?'active':'')}/>)}
        </div>
        <div style={{height:12}} />
        <div className="row">
          <button className="button btn-outline" onClick={onClose}>Close</button>
          <button className="button" onClick={next}>Next</button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Core Tabs ---------------- */
function NewTab({ uid, categories, currency, budgetsDocRef }) {
  const [type, setType] = useState('expense')
  const [category, setCategory] = useState(categories[0] || 'Other')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DDTHH:mm'))
  const [note, setNote] = useState('')
  const [leftText, setLeftText] = useState('')
  const [leftValue, setLeftValue] = useState(null)

  const [catBudgets, setCatBudgets] = useState({})
  const monthKey = dayjs(date).format('YYYY-MM')

  useEffect(() => onSnapshot(budgetsDocRef, (snap) => {
    if (snap.exists()) setCatBudgets(snap.data().categoryBudgets || {})
  }), [budgetsDocRef])

  useEffect(() => {
    if (!category) return
    const start = dayjs(monthKey + '-01').startOf('day').toISOString()
    const end = dayjs(monthKey).endOf('month').endOf('day').toISOString()
    const q = query(
      collection(db, 'households', uid, 'transactions'),
      where('date', '>=', start),
      where('date', '<=', end),
      where('type', '==', 'expense'),
      where('category', '==', category),
      orderBy('date', 'desc')
    )
    return onSnapshot(q, (snap) => {
      let spent = 0
      snap.forEach(doc => { spent += Number(doc.data().amount || 0) })
      const budget = Number(catBudgets[category] || 0)
      const left = budget - spent - Number(amount || 0)
      setLeftValue(left)
      if (budget > 0) setLeftText(`${currencySymbol(currency)}${left.toFixed(2)} left this month for ${category}`)
      else setLeftText('No budget set for this category.')
    })
  }, [uid, category, amount, monthKey, currency, catBudgets])

  const save = async () => {
    if (!amount || Number(amount) <= 0) return alert('Enter a valid amount')
    const iso = dayjs(date).toISOString()
    await addDoc(collection(db, 'households', uid, 'transactions'), {
      type, amount: Number(amount), category, date: iso, note: note || ''
    })
    setAmount(''); setNote('')
    if (type === 'expense' && leftValue !== null) {
      alert(`Saved. Left this month for ${category}: ${currencySymbol(currency)}${leftValue.toFixed(2)}`)
    } else {
      alert('Saved')
    }
  }

  return (
    <div className="card">
      <div className="row">
        <button className={'button btn-danger ' + (type==='expense'?'':'btn-outline')} onClick={()=>setType('expense')}>Expense</button>
        <button className={'button btn-success ' + (type==='income'?'':'btn-outline')} onClick={()=>setType('income')}>Income</button>
      </div>
      <div style={{height:10}} />
      <select className="input" value={category} onChange={e=>setCategory(e.target.value)}>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <div style={{height:8}} />
      <input className="input" type="number" inputMode="decimal" placeholder="Amount" value={amount} onChange={e=>setAmount(e.target.value)} />
      <div style={{height:8}} />
      <input className="input" type="datetime-local" value={date} onChange={e=>setDate(e.target.value)} />
      <div style={{height:8}} />
      <textarea className="input" rows="3" placeholder="Note (optional)" value={note} onChange={e=>setNote(e.target.value)} />
      <div style={{height:8}} />
      <div className="small">{leftText}</div>
      <div style={{height:8}} />
      <button className="button" onClick={save}>Save</button>
    </div>
  )
}

function OverviewTab({ uid, categories, currency }) {
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'))
  const [type, setType] = useState('All')
  const [cat, setCat] = useState('All')
  const [tx, setTx] = useState([])
  const months = [...Array(4)].map((_,i)=> dayjs().subtract(i, 'month').format('YYYY-MM'))

  useEffect(() => {
    const start = dayjs(monthKey + '-01').startOf('day').toISOString()
    const end = dayjs(monthKey).endOf('month').endOf('day').toISOString()
    const qRef = query(
      collection(db, 'households', uid, 'transactions'),
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date', 'desc')
    )
    return onSnapshot(qRef, (snap) => {
      const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() })); setTx(list)
    })
  }, [uid, monthKey])

  const filtered = tx.filter(t => (type==='All' || t.type===type) && (cat==='All' || t.category===cat))

  const onDelete = async (id) => {
    const ok = window.confirm('Delete this entry? This cannot be undone.')
    if (!ok) return
    await deleteDoc(doc(db, 'households', uid, 'transactions', id))
  }

  return (
    <div>
      <div className="card">
        <div className="badge-row">
          {months.map(m => (
            <button key={m} className={'badge ' + (m===monthKey?'active':'')} onClick={()=>setMonthKey(m)}>{m}</button>
          ))}
        </div>
        <div style={{height:8}} />
        <div className="row">
          <select className="input" value={type} onChange={e=>setType(e.target.value)}>
            <option>All</option>
            <option>income</option>
            <option>expense</option>
          </select>
          <select className="input" value={cat} onChange={e=>setCat(e.target.value)}>
            <option>All</option>
            {categories.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="list">
        {filtered.map(t => (
          <div key={t.id} className="item">
            <div>
              <div style={{fontWeight:700}}>{t.category} • {dayjs(t.date).format('MMM D, HH:mm')}</div>
              {t.note && <div className="note">{t.note}</div>}
            </div>
            <div style={{display:'flex', alignItems:'center', gap:8}}>
              <div className={t.type === 'income' ? 'amount-pos' : 'amount-neg'}>
                {t.type === 'income' ? '+' : '-'} {currencySymbol(currency)}{Number(t.amount).toFixed(2)}
              </div>
              <button aria-label="Delete entry" title="Delete" onClick={()=>onDelete(t.id)}
                style={{background:'transparent', border:'none', color:'var(--muted)', padding:4, cursor:'pointer'}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="small center">No transactions</p>}
      </div>
    </div>
  )
}

function AnalyticsTab({ uid, categories, currency }) {
  const [monthKey, setMonthKey] = useState(dayjs().format('YYYY-MM'))
  const [tx, setTx] = useState([])
  const [range, setRange] = useState('this')
  const [showLine, setShowLine] = useState(false)
  const [showLeft, setShowLeft] = useState(false)
  const [catBudgets, setCatBudgets] = useState({})
  const analyticsRef = useRef(null)

  useEffect(() => onSnapshot(doc(db, 'households', uid, 'settings', 'budget'), (snap) => {
    if (snap.exists()) setCatBudgets(snap.data().categoryBudgets || {})
  }), [uid])

  useEffect(() => {
    let start, end
    if (range === 'this') {
      start = dayjs(monthKey + '-01').startOf('day')
      end = dayjs(monthKey).endOf('month').endOf('day')
    } else {
      end = dayjs().endOf('month').endOf('day')
      start = dayjs().subtract(3, 'month').startOf('month')
    }
    const qRef = query(
      collection(db, 'households', uid, 'transactions'),
      where('date', '>=', start.toISOString()),
      where('date', '<=', end.toISOString()),
      orderBy('date', 'desc')
    )
    return onSnapshot(qRef, (snap) => {
      const list = []; snap.forEach(d => list.push({ id: d.id, ...d.data() })); setTx(list)
    })
  }, [uid, monthKey, range])

  const expenseByCat = useMemo(() => {
    const acc = {}; let total = 0
    tx.filter(t=>t.type==='expense').forEach(t => {
      acc[t.category] = (acc[t.category]||0) + Number(t.amount||0)
      total += Number(t.amount||0)
    })
    return { acc, total }
  }, [tx])

  const byMonth = useMemo(() => {
    const acc = {}
    tx.forEach(t => {
      const mk = dayjs(t.date).format('YYYY-MM')
      if (!acc[mk]) acc[mk] = { income:0, expense:0 }
      acc[mk][t.type] += Number(t.amount||0)
    })
    const labels = Object.keys(acc).sort()
    return { labels, income: labels.map(l => acc[l].income), expense: labels.map(l => acc[l].expense) }
  }, [tx])

  const palette = ['#2563eb','#22c55e','#ef4444','#eab308','#06b6d4','#a855f7','#f97316','#14b8a6','#84cc16','#ec4899']
  const labelsD = Object.keys(expenseByCat.acc)
  const doughnutData = { labels: labelsD, datasets: [{ data: Object.values(expenseByCat.acc), backgroundColor: labelsD.map((_,i)=> palette[i % palette.length]), borderWidth: 0 }] }
  const doughnutOpts = {
    plugins: { tooltip: { callbacks: { label: (ctx) => {
      const value = ctx.raw || 0
      const pct = expenseByCat.total ? (value/expenseByCat.total*100).toFixed(1) : 0
      return `${ctx.label}: ${currencySymbol(currency)}${value.toFixed(2)} • ${pct}%`
    }}}, legend: { position: 'bottom' } },
    maintainAspectRatio: false
  }
  const lineData = { labels: byMonth.labels, datasets: [
    { label: 'Income', data: byMonth.income, tension: 0.3 },
    { label: 'Expense', data: byMonth.expense, tension: 0.3 }
  ]}

  const expensesThisMonthByCat = useMemo(() => {
    const map = {}
    tx.forEach(t => {
      if (t.type !== 'expense') return
      if (dayjs(t.date).format('YYYY-MM') !== monthKey) return
      map[t.category] = (map[t.category] || 0) + Number(t.amount || 0)
    })
    return map
  }, [tx, monthKey])

  const leftByCat = useMemo(() => {
    const res = {}
    const cats = new Set([...Object.keys(catBudgets || {}), ...categories])
    cats.forEach(c => {
      const budget = Number((catBudgets || {})[c] || 0)
      if (budget <= 0) return
      const spent = Number(expensesThisMonthByCat[c] || 0)
      res[c] = budget - spent
    })
    return res
  }, [catBudgets, expensesThisMonthByCat, categories])

  const exportCSV = () => {
    const csv = Papa.unparse(tx.map(t => ({ type: t.type, amount: t.amount, category: t.category, date: t.date, note: t.note })))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = `jinofin-${dayjs().format('YYYYMMDD-HHmm')}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const exportPDF = async () => {
    const node = analyticsRef.current
    const canvas = await html2canvas(node, { scale: 2 }); const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4'); const pageWidth = pdf.internal.pageSize.getWidth(); const pageHeight = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height); const w = canvas.width * ratio; const h = canvas.height * ratio
    pdf.addImage(imgData, 'PNG', (pageWidth - w)/2, 10, w, h); pdf.save(`jinofin-analytics-${dayjs().format('YYYYMMDD-HHmm')}.pdf`)
  }

  const months = [...Array(4)].map((_,i)=> dayjs().subtract(i, 'month').format('YYYY-MM'))

  return (
    <div>
      <div className="card">
        <div className="badge-row">
          {months.map(m => (
            <button key={m} className={'badge ' + (m===monthKey?'active':'')} onClick={()=>setMonthKey(m)}>{m}</button>
          ))}
        </div>
        <div style={{height:8}} />
        <div className="row">
          <button className="button btn-outline" onClick={()=>setRange('this')}>This month</button>
          <button className="button btn-outline" onClick={()=>setRange('last3')}>Last 3 months</button>
        </div>
      </div>

      <div className="card" ref={analyticsRef}>
        <h3>Expense by Category</h3>
        <div style={{height:240}}>
          <Doughnut data={doughnutData} options={doughnutOpts} />
        </div>

        <div style={{height:16}} />
        <div className="row">
          <h3 style={{margin:0}}>Income vs Expense</h3>
          <button className="button btn-outline" onClick={()=>setShowLine(s=>!s)}>{showLine ? 'Hide' : 'Show'}</button>
        </div>
        {showLine && <div className="chart-compact"><Line data={lineData} options={{ maintainAspectRatio: false }} /></div>}

        <div style={{height:16}} />
        <div className="row">
          <h3 style={{margin:0}}>Left to Spend (by Category)</h3>
          <button className="button btn-outline" onClick={()=>setShowLeft(s=>!s)}>{showLeft ? 'Hide' : 'Show'}</button>
        </div>
        {showLeft && (
          <div className="list">
            {Object.keys(leftByCat).length === 0 && <p className="small">No category budgets set for {monthKey}.</p>}
            {Object.entries(leftByCat).sort(([a],[b]) => a.localeCompare(b)).map(([c, left]) => (
              <div key={c} className="item">
                <div style={{fontWeight:700}}>{c}</div>
                <div className={left >= 0 ? 'amount-pos' : 'amount-neg'}>
                  {left >= 0 ? '' : '− '}{currencySymbol(currency)}{Math.abs(left).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="row">
        <button className="button" onClick={exportCSV}>Export CSV</button>
        <button className="button btn-outline" onClick={exportPDF}>Export PDF</button>
      </div>
    </div>
  )
}

function SettingsTab({ uid, currency, setCurrency, categories, setCategories }) {
  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'dark')
  const [totalBudget, setTotalBudget] = useState(2000)
  const [catBudgets, setCatBudgets] = useState({})
  const [displayName, setDisplayName] = useState(auth.currentUser?.displayName || '')
  const [email, setEmail] = useState(auth.currentUser?.email || '')
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [savingAcc, setSavingAcc] = useState(false)

  useEffect(() => {
    const unsubMain = onSnapshot(doc(db, 'households', uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setCurrency(d.currency || 'EUR')
        setCategories(d.categories || DEFAULT_CATEGORIES)
      }
    })
    const unsubBudget = onSnapshot(doc(db, 'households', uid, 'settings', 'budget'), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setTotalBudget(d.totalBudget || 2000)
        setCatBudgets(d.categoryBudgets || {})
      }
    })
    return () => { unsubMain(); unsubBudget(); }
  }, [uid])

  const applyTheme = (t) => {
    setTheme(t); document.documentElement.setAttribute('data-theme', t); localStorage.setItem('theme', t)
  }

  const saveMain = async () => {
    await setDoc(doc(db, 'households', uid), { categories, currency, totalBudget }, { merge: true })
    await setDoc(doc(db, 'households', uid, 'settings', 'budget'), { totalBudget, categoryBudgets: catBudgets, currency }, { merge: true })
    alert('Saved settings')
  }

  const addCategory = () => {
    const name = prompt('New category name')
    if (!name) return
    if (categories.includes(name)) return alert('Category exists')
    setCategories([...categories, name])
  }

  const setCatBudget = (c, v) => setCatBudgets(prev => ({ ...prev, [c]: Number(v)||0 }))

  const reauth = async () => {
    const user = auth.currentUser
    if (!user?.email || !currentPw) throw new Error('Current password required.')
    const cred = EmailAuthProvider.credential(user.email, currentPw)
    await reauthenticateWithCredential(user, cred)
  }

  const saveAccount = async () => {
    try {
      setSavingAcc(true)
      const user = auth.currentUser
      if (!user) throw new Error('No user.')
      // Update display name
      if (displayName !== user.displayName) {
        await updateProfile(user, { displayName })
        await setDoc(doc(db, 'households', uid), { name: displayName }, { merge: true })
      }
      // Email or password changes require reauth
      if ((email && email !== user.email) || newPw) await reauth()
      if (email && email !== user.email) await updateEmail(user, email)
      if (newPw) await updatePassword(user, newPw)
      alert('Account updated.')
      setCurrentPw(''); setNewPw('')
    } catch (e) {
      alert(e.message || 'Failed to update account.')
    } finally {
      setSavingAcc(false)
    }
  }

  return (
    <div className="card">
      <h3>Appearance</h3>
      <div className="row">
        <button className={'button ' + (theme==='dark'?'':'btn-outline')} onClick={()=>applyTheme('dark')}>Dark</button>
        <button className={'button ' + (theme==='light'?'':'btn-outline')} onClick={()=>applyTheme('light')}>Light</button>
        <button className={'button ' + (theme==='playful'?'':'btn-outline')} onClick={()=>applyTheme('playful')}>Playful</button>
      </div>

      <div style={{height:12}} />
      <h3>Currency</h3>
      <select className="input" value={currency} onChange={e=>setCurrency(e.target.value)}>
        <option value="EUR">EUR</option>
        <option value="USD">USD</option>
        <option value="GBP">GBP</option>
        <option value="EGP">EGP</option>
        <option value="AED">AED</option>
      </select>

      <div style={{height:12}} />
      <h3>Budgets</h3>
      <input className="input" type="number" value={totalBudget} onChange={e=>setTotalBudget(e.target.value)} placeholder="Overall monthly budget" />
      <div style={{height:8}} />
      <div className="list">
        {categories.map(c => (
          <div className="item" key={c}>
            <div>{c}</div>
            <input className="input" type="number" value={catBudgets[c]||''} onChange={e=>setCatBudget(c, e.target.value)} placeholder="0" style={{maxWidth:120}} />
          </div>
        ))}
      </div>
      <div className="row">
        <button className="button btn-outline" onClick={addCategory}>Add Category</button>
        <button className="button" onClick={saveMain}>Save</button>
      </div>

      <div style={{height:12}} />
      <h3>Account</h3>
      <input className="input" placeholder="Display name" value={displayName} onChange={e=>setDisplayName(e.target.value)} />
      <div style={{height:8}} />
      <input className="input" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
      <div style={{height:8}} />
      <input className="input" placeholder="Current password (for email/password changes)" type="password" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} />
      <div style={{height:8}} />
      <input className="input" placeholder="New password (optional)" type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} />
      <div style={{height:8}} />
      <div className="row">
        <button className="button btn-outline" disabled={savingAcc} onClick={()=>signOut(auth)}>Sign out</button>
        <button className="button" disabled={savingAcc} onClick={saveAccount}>{savingAcc ? 'Saving…' : 'Save account'}</button>
      </div>
    </div>
  )
}

/* ---------------- App ---------------- */
export default function App() {
  const { user, loading } = useAuth()
  const [tab, setTab] = useState('New')
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [currency, setCurrency] = useState('EUR')

  const [showSignUp, setShowSignUp] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (!user) return
    const unsub = onSnapshot(doc(db, 'households', user.uid), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setCategories(d.categories || DEFAULT_CATEGORIES)
        setCurrency(d.currency || 'EUR')
      }
    })
    return () => unsub()
  }, [user])

  if (loading) return <div className="app"><Header currency={'EUR'} /><div className="content"><p>Loading…</p></div></div>

  // Signed-out: show Welcome with Sign in card + Sign up + Help
  if (!user) {
    return (
      <>
        <Welcome
          onContinueSignIn={()=>{}}
          onShowSignUp={()=>setShowSignUp(true)}
          onShowHelp={()=>setShowHelp(true)}
        />
        {showSignUp && <SignUpSheet onClose={()=>setShowSignUp(false)} />}
        {showHelp && <HelpSheet onClose={()=>setShowHelp(false)} />}
      </>
    )
  }

  // Signed-in: main app
  return (
    <div className="app">
      <Header currency={currency} />
      <div className="content">
        {tab === 'New' && <NewTab uid={user.uid} categories={categories} currency={currency} budgetsDocRef={doc(db, 'households', user.uid, 'settings', 'budget')} />}
        {tab === 'Overview' && <OverviewTab uid={user.uid} categories={categories} currency={currency} />}
        {tab === 'Analytics' && <AnalyticsTab uid={user.uid} categories={categories} currency={currency} />}
        {tab === 'Settings' && <SettingsTab uid={user.uid} currency={currency} setCurrency={setCurrency} categories={categories} setCategories={setCategories} />}
      </div>
      <Navbar tab={tab} setTab={setTab} />
    </div>
  )
}
