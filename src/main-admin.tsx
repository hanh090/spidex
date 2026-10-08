import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './styles/base.css'
import { AdminApp } from './app/AdminApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode><AdminApp /></StrictMode>,
)
