import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// CI stamps package.json with 1.0.<run>; the phone and iPad builds compare it with the latest release
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version as string

// base './' so the build works from file:// (Electron) and capacitor://
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    strictPort: true,
    // Senkuro and RanobeHub send no CORS headers; the apps reach them natively or through Electron
    proxy: {
      '/senkuro': { target: 'https://api.senkuro.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/senkuro/, '') },
      '/ranobehub': { target: 'https://ranobehub.org', changeOrigin: true, rewrite: (p) => p.replace(/^\/ranobehub/, '') },
    },
  },
})
