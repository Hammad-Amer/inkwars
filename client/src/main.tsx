import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Home from './pages/Home'
import ModelTest from './pages/ModelTest'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/model-test', element: <ModelTest /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
