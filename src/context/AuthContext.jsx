import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../service/api'

const AuthContext = createContext(null)

// Clears auth keys from localStorage. Accepts the current user object (or null)
// so it always has the correct id even when called from a stale closure.
function _clearStorage(currentUser) {
  const stored = localStorage.getItem('zeno_user')
  let uid = currentUser?.id
  if (!uid && stored) {
    try { uid = JSON.parse(stored)?.id } catch { /* ignore */ }
  }
  localStorage.removeItem('zeno_token')
  localStorage.removeItem('zeno_user')
  if (uid) localStorage.removeItem(`zeno_sessions_${uid}`)
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  // Rehydrate: validate token against /auth/me on every mount
  useEffect(() => {
    const token = localStorage.getItem('zeno_token')
    if (!token) {
      setLoading(false)
      return
    }
    api.getMe()
      .then(userData => {
        localStorage.setItem('zeno_user', JSON.stringify(userData))
        setUser(userData)
      })
      .catch(() => {
        // Token invalid or expired — clear everything
        _clearStorage(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
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
    _clearStorage(user)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
