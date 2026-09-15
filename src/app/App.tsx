import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './layout'
import { Explore } from '../screens/explore'
import { Identify } from '../screens/identify'
import { Sightings } from '../screens/sightings'
import { SpeciesDetail } from '../screens/species-detail'
import { Compare } from '../screens/compare'
import { LogSighting } from '../screens/log-sighting'
import { SightingDetail } from '../screens/sighting-detail'
import { Packs } from '../screens/packs'
import { AuthCallback } from '../screens/auth-callback'
import { AuthProvider } from '../features/auth/auth-context'
import { NotFound } from '../screens/not-found'

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <Explore /> },
      { path: 'identify', element: <Identify /> },
      { path: 'sightings', element: <Sightings /> },
      // Pushes from the three tabs — never tabs of their own.
      { path: 'species/:id', element: <SpeciesDetail /> },
      { path: 'compare', element: <Compare /> },
      { path: 'log', element: <LogSighting /> },
      { path: 'sightings/:id', element: <SightingDetail /> },
      { path: 'library', element: <Packs /> },
      { path: 'auth/callback', element: <AuthCallback /> },
      // Anything else. Without this, an unknown path raises out of the router
      // and the user gets React Router's raw error page.
      { path: '*', element: <NotFound /> },
    ],
  },
])

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  )
}

