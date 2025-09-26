import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import { ToastProvider } from './components/Toast.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'

const rootElement = document.getElementById('root')

// Apply saved theme (default to 'dark')
const savedTheme = localStorage.getItem('theme')
document.documentElement.setAttribute('data-theme', savedTheme || 'dark')

// Fixed navbar height for layout spacing
document.documentElement.style.setProperty('--nav-height', '72px')

createRoot(rootElement).render(
  <React.StrictMode>
    <ToastProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ToastProvider>
  </React.StrictMode>
)
