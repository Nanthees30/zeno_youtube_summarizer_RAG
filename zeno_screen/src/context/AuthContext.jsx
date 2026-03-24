import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../service/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // Rehydrate from localStorage on mount
  useEffect(() => {
    const token    = localStorage.getItem('zeno_token')
    const userData = localStorage.getItem('zeno_user')
    if (token && userData) {
      try { setUser(JSON.parse(userData)) } catch { logout() }
    }
    setLoading(false)
  }, [])

  // L-6: proactive token refresh — check every 30 min, refresh if within 1 hour of expiry
  useEffect(() => {
    if (!user) return

    function tokenExpiresInMs() {
      const token = localStorage.getItem('zeno_token')
      if (!token) return 0
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        return payload.exp * 1000 - Date.now()
      } catch {
        return 0
      }
    }

    async function tryRefresh() {
      if (tokenExpiresInMs() > 3_600_000) return   // more than 1 hour left — skip
      try {
        const data = await api.refreshToken()
        localStorage.setItem('zeno_token', data.access_token)
      } catch {
        // If refresh fails the next real request will return 401 and redirect
      }
    }

    tryRefresh()
    const id = setInterval(tryRefresh, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [user])

  async function login(email, password) {
    const { data } = await api.authLogin(email, password)
    localStorage.setItem('zeno_token', data.access_token)
    localStorage.setItem('zeno_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }

  async function register(username, email, password, name) {
    const { data } = await api.authRegister(username, email, password, name)
    localStorage.setItem('zeno_token', data.access_token)
    localStorage.setItem('zeno_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
  }

  function logout() {
    localStorage.removeItem('zeno_token')
    localStorage.removeItem('zeno_user')
    if (user?.id) localStorage.removeItem(`zeno_sessions_${user.id}`)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
