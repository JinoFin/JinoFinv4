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
  signOut
} from 'firebase/auth'
import {
  getFirestore,
  doc, setDoc, getDoc,
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
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u); setLoading(false)
    })
  }, [])
  return { user, loading }
}

function currencySymbol(curr) {
  switch (curr) {
    case 'USD': return '$'
    case 'GBP': return '£'
    case 'EGP': return 'E£'
    default: return '€'
  }
}

function Header({ currency }) {
  return (
    <div className="header">
      <div className="brand">JinoFin</div>
      <div className="currency">{currencySymbol(currency)} • {currency}</div>
    </div>
  )
}

function Navbar({ tab, setTab }) {
  const tabs = ['New','Overview','Analytics','Settings']
  return (
    <nav className="navbar">
      {tabs.map(t => (
        <button key={t} className={'nav-btn ' + (tab===t ? 'active':'') } onClick={() => setTab(t)}>{t}</button>
      ))}
    </nav>
  )
}

function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleContinue = async () => {
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password)
          const uid = cred.user.uid
          // Seed defaults
          await setDoc(doc(db, 'households', uid), {
            categories: DEFAULT_CATEGORIES,
            currency: 'EUR',
            totalBudget: 2000
          })
          await setDoc(doc(db, 'households', uid, 'settings', 'budget'), {
            totalBudget: 2000,
            categoryBudgets: {},
            currency: 'EUR'
          })
        } catch (e2) {
          setError(e2.message)
        }
      } else {
        setError(e.message)
      }
    }
  }

  return (
    <div className="app">
      <Header currency={'EUR'} />
      <div className="content">
        <div className="card">
          <h3>Welcome</h3>
          <p className="small">Email/Password only. Tap Continue to sign in; if you don't have an account, we'll create it and seed defaults.</p>
          <input className="input" placeholder="Email" type="email" value={email} onChange={e=>setEmail(e.target.value)} />
          <div style={{ height: 8 }} />
          <input className="input" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
          <div style={{ height: 12 }} />
          <button className="button" onClick={handleContinue}>Continue</button>
          {error && <p className="small" style={{color: 'var(--danger)'}}>{error}</p>}
        </div>
      </div>
    </div>
  )
}

function NewTab({ uid, categories, currency, budgetsDocRef }) {
  const [type, setType] = useState('expense')
  const [category, setCategory] = useState(categories[0] || 'Other')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DDTHH:mm'))
  const [note, setNote] = useState('')
  const [leftText, setLeftText] = useState('')

  const [catBudgets, setCatBudgets] = useState({})
  const monthKey = dayjs(date).format('YYYY-MM')

  useEffect(() => {
    const unsub = onSnapshot(budgetsDocRef, (snap) => {
      if (snap.exists()) {
        setCatBudgets(snap.data().categoryBudgets || {})
      }
    })
    return () => unsub()
  }, [budgetsDocRef])

  // Compute "Left this month" for selected category
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
    const unsub = onSnapshot(q, (snap) => {
      let spent = 0
      snap.forEach(doc => { spent += Number(doc.data().amount || 0) })
      const budget = Number(catBudgets[category] || 0)
      const left = budget - spent - Number(amount || 0)
      if (budget > 0) setLeftText(`${currencySymbol(currency)}${left.toFixed(2)} left this month for ${category}`)
      else setLeftText('No budget set for this category.')
    })
    return () => unsub()
  }, [uid, category, amount, monthKey, currency, catBudgets])

  const save = async () => {
    if (!amount || Number(amount) <= 0) return alert('Enter a valid amount')
    const iso = dayjs(date).toISOString()
    await addDoc(collection(db, 'households', uid, 'transactions'), {
      type, amount: Number(amount), category, date: iso, note: note || ''
    })
    setAmount(''); setNote('')
    alert('Saved')
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
    let qRef = query(
      collection(db, 'households', uid, 'transactions'),
      where('date', '>=', start),
      where('date', '<=', end),
      orderBy('date', 'desc')
    )
    const unsub = onSnapshot(qRef, (snap) => {
      let list = []
      snap.forEach(d => list.push({ id: d.id, ...d.data() }))
      setTx(list)
    })
    return () => unsub()
  }, [uid, monthKey])

  const filtered = tx.filter(t => (type==='All' || t.type===type) && (cat==='All' || t.category===cat))

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
            <div className={t.type === 'income' ? 'amount-pos' : 'amount-neg'}>
              {t.type === 'income' ? '+' : '-'} {currencySymbol(currency)}{Number(t.amount).toFixed(2)}
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
  const [range, setRange] = useState('this') // this or last3
  const analyticsRef = useRef(null)

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
    const unsub = onSnapshot(qRef, (snap) => {
      let list = []
      snap.forEach(d => list.push({ id: d.id, ...d.data() }))
      setTx(list)
    })
    return () => unsub()
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
    return {
      labels,
      income: labels.map(l => acc[l].income),
      expense: labels.map(l => acc[l].expense)
    }
  }, [tx])

  const doughnutData = {
    labels: Object.keys(expenseByCat.acc),
    datasets: [{
      data: Object.values(expenseByCat.acc),
      borderWidth: 0
    }]
  }
  const doughnutOpts = {
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = ctx.raw || 0
            const pct = expenseByCat.total ? (value/expenseByCat.total*100).toFixed(1) : 0
            return `${ctx.label}: ${currencySymbol(currency)}${value.toFixed(2)} • ${pct}%`
          }
        }
      },
      legend: { position: 'bottom' }
    },
    maintainAspectRatio: false
  }

  const lineData = {
    labels: byMonth.labels,
    datasets: [
      { label: 'Income', data: byMonth.income, tension: 0.3 },
      { label: 'Expense', data: byMonth.expense, tension: 0.3 }
    ]
  }

  const exportCSV = () => {
    const csv = Papa.unparse(tx.map(t => ({
      type: t.type, amount: t.amount, category: t.category, date: t.date, note: t.note
    })))
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `jinofin-${dayjs().format('YYYYMMDD-HHmm')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportPDF = async () => {
    const node = analyticsRef.current
    const canvas = await html2canvas(node, { scale: 2 })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const ratio = Math.min(pageWidth / canvas.width, pageHeight / canvas.height)
    const w = canvas.width * ratio
    const h = canvas.height * ratio
    pdf.addImage(imgData, 'PNG', (pageWidth - w)/2, 10, w, h)
    pdf.save(`jinofin-analytics-${dayjs().format('YYYYMMDD-HHmm')}.pdf`)
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
        <h3>Income vs Expense</h3>
        <Line data={lineData} options={{ maintainAspectRatio: false }} />
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
    setTheme(t)
    document.documentElement.setAttribute('data-theme', t)
    localStorage.setItem('theme', t)
  }

  const saveMain = async () => {
    await setDoc(doc(db, 'households', uid), {
      categories, currency, totalBudget
    }, { merge: true })
    await setDoc(doc(db, 'households', uid, 'settings', 'budget'), {
      totalBudget, categoryBudgets: catBudgets, currency
    }, { merge: true })
    alert('Saved settings')
  }

  const addCategory = () => {
    const name = prompt('New category name')
    if (!name) return
    if (categories.includes(name)) return alert('Category exists')
    setCategories([...categories, name])
  }

  const setCatBudget = (c, v) => {
    setCatBudgets(prev => ({ ...prev, [c]: Number(v)||0 }))
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
      <button className="button btn-outline" onClick={()=>signOut(auth)}>Sign out</button>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  const [tab, setTab] = useState('New')
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [currency, setCurrency] = useState('EUR')

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
  if (!user) return <SignIn />

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
