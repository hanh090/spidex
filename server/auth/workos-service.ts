import { WorkOS } from '@workos-inc/node'
import fs from 'fs'
import path from 'path'

// Helper to load env vars from .env if running directly without dotenv
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)?\s*$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2]?.trim() ?? ''
      }
    }
  }
}

loadEnv()

const clientId = process.env.WORKOS_CLIENT_ID || ''

// Lazy: vite.config imports this module for the dev plugin, and CI/test runs
// have no WorkOS credentials — constructing at load would kill the config.
let _workos: WorkOS | undefined
export function getWorkos(): WorkOS {
  if (!_workos) {
    _workos = new WorkOS(process.env.WORKOS_API_KEY || '', { clientId })
  }
  return _workos
}
export { clientId }

export interface AuthSessionUser {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
  emailVerified?: boolean
  createdAt: string
  updatedAt: string
}

export interface AuthResponse {
  user: AuthSessionUser
  accessToken?: string
  refreshToken?: string
}

/**
 * Headless password authentication - does not redirect off-origin.
 * Crucial for iOS standalone PWA where redirects break session partitions.
 */
export async function authenticateWithPassword(email: string, password: string): Promise<AuthResponse> {
  const res = await getWorkos().userManagement.authenticateWithPassword({
    email,
    password,
    clientId,
  })

  return {
    user: {
      id: res.user.id,
      email: res.user.email,
      firstName: res.user.firstName,
      lastName: res.user.lastName,
      profilePictureUrl: res.user.profilePictureUrl,
      emailVerified: res.user.emailVerified,
      createdAt: res.user.createdAt,
      updatedAt: res.user.updatedAt,
    },
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
  }
}

/**
 * Creates a new user account with email and password
 */
export async function createUser(email: string, password: string, firstName?: string, lastName?: string): Promise<AuthSessionUser> {
  const user = await getWorkos().userManagement.createUser({
    email,
    password,
    firstName,
    lastName,
  })

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePictureUrl: user.profilePictureUrl,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

/**
 * Generates OAuth Authorization URL for Google or Microsoft
 */
export function getOAuthAuthorizationUrl(provider: 'GoogleOAuth' | 'MicrosoftOAuth' | 'authkit', redirectUri: string): string {
  return getWorkos().userManagement.getAuthorizationUrl({
    provider,
    redirectUri,
    clientId,
  })
}

/**
 * Exchanges OAuth authorization code for session & user profile
 */
export async function authenticateWithCode(code: string): Promise<AuthResponse> {
  const res = await getWorkos().userManagement.authenticateWithCode({
    code,
    clientId,
  })

  return {
    user: {
      id: res.user.id,
      email: res.user.email,
      firstName: res.user.firstName,
      lastName: res.user.lastName,
      profilePictureUrl: res.user.profilePictureUrl,
      emailVerified: res.user.emailVerified,
      createdAt: res.user.createdAt,
      updatedAt: res.user.updatedAt,
    },
    accessToken: res.accessToken,
    refreshToken: res.refreshToken,
  }
}

/**
 * Fetches user profile by WorkOS user ID
 */
export async function getUser(userId: string): Promise<AuthSessionUser | null> {
  try {
    const user = await getWorkos().userManagement.getUser(userId)
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profilePictureUrl: user.profilePictureUrl,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  } catch {
    return null
  }
}
