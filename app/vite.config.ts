import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// base './' so the build works from file:// (Electron) and capacitor://
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Senkuro has no CORS headers; the apps reach it natively or through Electron
    proxy: { '/senkuro': { target: 'https://api.senkuro.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/senkuro/, '') } },
  },
})
