export interface User {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  profilePictureUrl?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AuthState {
  user: User | null
  loading: boolean
  isGuest: boolean
}
