import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { ToastProvider } from './components/Toast.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

// Apply theme from localStorage (default 'dark')
const savedTheme = localStorage.getItem('theme')
if (savedTheme) {
  document.documentElement.setAttribute('data-theme', savedTheme)
} else {
  document.documentElement.setAttribute('data-theme', 'dark')
}

// Set CSS variable for nav height
document.documentElement.style.setProperty('--nav-height', '72px')

const rootElement = document.getElementById('root')

createRoot(rootElement).render(
  <React.StrictMode>
    <ToastProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ToastProvider>
  </React.StrictMode>
)
