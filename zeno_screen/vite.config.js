import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/auth':          'http://localhost:8000',
      '/chat':          'http://localhost:8000',
      '/index-video':   'http://localhost:8000',
      '/video-status':  'http://localhost:8000',
      '/videos':        'http://localhost:8000',
      '/query-history': 'http://localhost:8000',
      '/health':        'http://localhost:8000',
    },
  }
})
