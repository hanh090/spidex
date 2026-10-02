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
import { Admin } from '../screens/admin'
import { Contribute } from '../screens/contribute'
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
      { path: 'contribute', element: <Contribute /> },
      { path: 'admin', element: <Admin /> },
      { path: 'auth/callback', element: <AuthCallback /> },
      // Anything else. Without this, an unknown path raises out of the router
      // and the user gets React Router's raw error page.
      { path: '*', element: <NotFound /> },
    ],
  },
], {
  // Opt into the v7 behaviours now so the upgrade is a no-op and the console
  // stays free of deprecation warnings. None of these routes use data APIs,
  // fetchers or relative links inside the splat route.
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
})

export function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </AuthProvider>
  )
}

