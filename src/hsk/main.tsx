import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkbookApp } from './WorkbookApp'
import './styles.css'

createRoot(document.getElementById('hsk-root')!).render(
  <StrictMode>
    <WorkbookApp />
  </StrictMode>,
)
