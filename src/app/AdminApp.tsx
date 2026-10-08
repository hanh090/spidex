import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Admin } from '../screens/admin'
import { AuthCallback } from '../screens/auth-callback'
import { AuthProvider } from '../features/auth/auth-context'

const router = createBrowserRouter([
  // The admin console renders its own NavBar; the field-guide Layout/drawer
  // does not belong on the admin domain.
  { path: '/', element: <Admin /> },
  { path: '/auth/callback', element: <AuthCallback /> },
  { path: '*', element: <Navigate to="/" replace /> },
], {
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
})

export function AdminApp() {
  return (
    <AuthProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AuthProvider>
  )
}
