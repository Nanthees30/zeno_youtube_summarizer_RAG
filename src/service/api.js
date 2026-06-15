import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

const http = axios.create({ baseURL: BASE_URL })

// ── Attach JWT to every request ────────────────────────────────────────────────
http.interceptors.request.use(config => {
  const token = localStorage.getItem('zeno_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Redirect to /login on 401 (guarded against multiple fires) ────────────────
let _redirecting = false
http.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401 && !_redirecting) {
      _redirecting = true
      localStorage.removeItem('zeno_token')
      localStorage.removeItem('zeno_user')
      window.location.href = '/login'
      setTimeout(() => { _redirecting = false }, 3000)
    }
    return Promise.reject(err)
  }
)

export const api = {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  authRegister: (username, email, password, name) =>
    http.post('/auth/register', { username, email, password, name }),
  authLogin: (email, password) =>
    http.post('/auth/login', { email, password }),
  getMe: () => http.get('/auth/me').then(r => r.data),

  // ── Videos ───────────────────────────────────────────────────────────────────
  indexVideo:  (url)      => http.post('/index-video', { url }).then(r => r.data),
  videoStatus: (video_id = null) =>
    http.get('/video-status', { params: video_id ? { video_id } : {} }).then(r => r.data),
  listVideos:  ()         => http.get('/videos').then(r => r.data),
  deleteVideo: (videoId)  => http.delete(`/videos/${videoId}`).then(r => r.data),

  // ── Chat ─────────────────────────────────────────────────────────────────────
  chat: (query, mode = 'chain', video_id = null, history = []) =>
    http.post('/chat', { query, mode, history, ...(video_id ? { video_id } : {}) }).then(r => r.data),

  chatStream: (query, mode = 'chain', video_id = null, history = []) => {
    const token = localStorage.getItem('zeno_token')
    if (!token) return Promise.reject(new Error('Not authenticated'))
    return fetch(`${BASE_URL}/chat/stream`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, mode, history, ...(video_id ? { video_id } : {}), _ts: Date.now() }),
    })
  },

  // ── Auth token refresh ───────────────────────────────────────────────────────
  refreshToken: () => http.post('/auth/refresh').then(r => r.data),

  // ── History ──────────────────────────────────────────────────────────────────
  queryHistory: (limit = 50) =>
    http.get('/query-history', { params: { limit } }).then(r => r.data),

  // ── Dashboard ────────────────────────────────────────────────────────────────
  /** GET /dashboard/stats — Pinecone vector DB usage + user metrics */
  dashboardStats: () => http.get('/dashboard/stats').then(r => r.data),
}
