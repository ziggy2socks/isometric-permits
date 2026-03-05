import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App.tsx'
import PermitMap from './PermitMap.tsx'

// Path-based routing — no router library needed
const isMapView = window.location.pathname.startsWith('/map');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isMapView ? <PermitMap /> : <App />}
  </StrictMode>,
)
