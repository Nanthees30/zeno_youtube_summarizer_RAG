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
      // Reset after navigation so HMR sessions don't permanently suppress future 401s
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
  /** POST /index-video — queue a YouTube URL for transcript extraction + indexing */
  indexVideo:  (url)      => http.post('/index-video', { url }).then(r => r.data),

  /** GET /video-status — { ready, indexing, total, ready_count } */
  videoStatus: (video_id = null) =>
    http.get('/video-status', { params: video_id ? { video_id } : {} }).then(r => r.data),

  /** GET /videos — list user's indexed videos */
  listVideos:  ()         => http.get('/videos').then(r => r.data),

  /** DELETE /videos/{videoId} — remove a video from the index */
  deleteVideo: (videoId)  => http.delete(`/videos/${videoId}`).then(r => r.data),

  // ── Chat ─────────────────────────────────────────────────────────────────────
  /** POST /chat → { answer, sources, model } */
  chat: (query, mode = 'chain', video_id = null, history = []) =>
    http.post('/chat', { query, mode, history, ...(video_id ? { video_id } : {}) }).then(r => r.data),

  /**
   * POST /chat/stream — returns a fetch Response for SSE consumption.
   * Events: { type:'sources', sources:[] } | { type:'token', content:'' } | { type:'done' }
   */
  chatStream: (query, mode = 'chain', video_id = null, history = []) => {
    const token = localStorage.getItem('zeno_token')
    if (!token) return Promise.reject(new Error('Not authenticated'))
    return fetch(`${BASE_URL}/chat/stream`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        Authorization: `Bearer ${token}`,
      },
      // _ts makes every request body unique, busting any server-side response cache
      body: JSON.stringify({ query, mode, history, ...(video_id ? { video_id } : {}), _ts: Date.now() }),
    })
  },

  // ── Auth token refresh ───────────────────────────────────────────────────────
  /** POST /auth/refresh — returns a fresh TokenResponse for a valid session */
  refreshToken: () => http.post('/auth/refresh').then(r => r.data),

  // ── History ──────────────────────────────────────────────────────────────────
  queryHistory: (limit = 50) =>
    http.get('/query-history', { params: { limit } }).then(r => r.data),
}
