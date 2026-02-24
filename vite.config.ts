import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5177,
    proxy: {
      // Proxy NYC Open Data API to avoid CORS in dev
      '/api/permits': {
        target: 'https://data.cityofnewyork.us',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/permits/, '/resource/ipu4-2q9a.json'),
      },
      // Proxy isometric NYC tiles (DZI xml + tile images) to avoid CORS
      '/dzi': {
        target: 'https://isometric-nyc-tiles.cannoneyed.com',
        changeOrigin: true,
      },
    },
  },
})
