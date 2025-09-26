import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import Papa from 'papaparse'

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
  getDoc,
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
      if (el.scrollTop <= 0) {
        startY = e.touches[0].clientY
      } else {
        startY = null
      }
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

function Header({ currency }) {
  return (
    <header className="app-header">
      <div className="brand">JinoFin</div>
      <div className="app-header-meta"><span>{currencySymbol(currency)} • {currency}</span></div>
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
    <nav className="navbar" role="tablist">
      {items.map((item) => (
        <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

/* ---------------- Auth: Welcome / Sign In / Sign Up / Help ---------------- */
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
    <div className="app-card elevated">
      <h3 className="card-title">Sign in</h3>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
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
      pushToast({ message: 'Account created!', variant: 'success' })
      onClose?.()
    } catch (err) {
      pushToast({ message: err.message || 'Sign up failed', variant: 'error', duration: 4200 })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">Create account</h3>
        <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
    { title: 'Add expenses fast', text: 'Quick buttons, smart budgets.' },
    { title: 'Overview & analytics', text: 'Search, filter, export with charts.' },
    { title: 'Offline PWA', text: 'Install on iOS/Android, works offline.' },
  ]
  const [index, setIndex] = useState(0)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="card-title">Why JinoFin?</h3>
        <div className="carousel">
          {slides.map((s, i) => (
            <div key={s.title} className={`slide ${index === i ? 'active' : ''}`}>
              <h4>{s.title}</h4>
              <p>{s.text}</p>
            </div>
          ))}
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

/* ---------------- App ---------------- */
export default function App() {
  const { user, loading } = useAuth()
  const [showSignUp, setShowSignUp] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [tab, setTab] = useState('New')
  const [currency, setCurrency] = useState('EUR')
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [totalBudget, setTotalBudget] = useState(2000)

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

  return (
    <div className="app-shell">
      <Header currency={currency} />
      <main className="app-content">
        {/* Tabs would be rendered here */}
        <p>Welcome, {user.displayName || user.email}</p>
      </main>
      <Navbar tab={tab} setTab={setTab} />
    </div>
  )
}
