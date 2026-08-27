import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
// const BASE_URL = 'http://127.0.0.1:8000'

const http = axios.create({ baseURL: BASE_URL })

// ── Simple Error Handler (No Login Redirects) ──────────────────────────────
http.interceptors.response.use(
  res => res,
  err => {
    console.error("API Error:", err.response?.data || err.message)
    return Promise.reject(err)
  }
)

export const api = {
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
    return fetch(`${BASE_URL}/chat/stream`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ query, mode, history, ...(video_id ? { video_id } : {}), _ts: Date.now() }),
    })
  },

  // ── History (Optional for public tool, can remove if unused) ─────────────────
  queryHistory: (limit = 50) =>
    http.get('/query-history', { params: { limit } }).then(r => r.data),

  // ── Dashboard (Optional for public tool) ─────────────────────────────────────
  dashboardStats: () => http.get('/dashboard/stats').then(r => r.data),
} 