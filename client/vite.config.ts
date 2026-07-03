import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // shared/ (socket protocol types) lives one level above the client root
    fs: { allow: ['..'] },
    // the game server; proxying keeps the socket same-origin (no CORS)
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
})
