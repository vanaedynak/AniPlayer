import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// CI stamps package.json with 1.0.<run>; the phone and iPad builds compare it with the latest release
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version as string
// which copy of the project this is: the main app or the lab (names, repository, link scheme)
const flavor = JSON.parse(readFileSync(new URL('./flavor.json', import.meta.url), 'utf-8'))

// base './' so the build works from file:// (Electron) and capacitor://
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version), __FLAVOR__: JSON.stringify(flavor) },
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
