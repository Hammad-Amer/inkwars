import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import Home from './pages/Home'
import ModelTest from './pages/ModelTest'
import Play from './pages/Play'
import Room from './pages/Room'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/play', element: <Play /> },
  { path: '/rooms', element: <Room /> },
  { path: '/rooms/:code', element: <Room /> },
  { path: '/model-test', element: <ModelTest /> },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
