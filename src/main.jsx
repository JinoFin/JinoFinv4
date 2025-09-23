import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

// Set theme from localStorage (default 'dark')
const theme = localStorage.getItem('theme') || 'dark'
document.documentElement.setAttribute('data-theme', theme)

createRoot(document.getElementById('root')).render(<App />)
