import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { QuickActions } from '../components/QuickActions'
import './styles/globals.css'

const hash = window.location.hash.replace('#', '')

if (hash === 'quick-actions') {
  // Mini toolbar mode — render only the QuickActions component
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QuickActions />
    </React.StrictMode>
  )
} else {
  // Main overlay mode
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
