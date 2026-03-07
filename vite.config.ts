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
      // configure() rewrites the raw path before http-proxy decodes it,
      // preserving %27/%25 encodings that Socrata requires
      '/api/permits': {
        target: 'https://data.cityofnewyork.us',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const raw = proxyReq.path.replace(/^\/api\/permits/, '/resource/rbx6-tga4.json');
            proxyReq.path = raw;
          });
        },
      },
      '/api/jobs': {
        target: 'https://data.cityofnewyork.us',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const raw = proxyReq.path.replace(/^\/api\/jobs/, '/resource/w9ak-ipjd.json');
            proxyReq.path = raw;
          });
        },
      },
      // Proxy isometric NYC tiles (DZI xml + tile images) to avoid CORS
      '/dzi': {
        target: 'https://isometric-nyc-tiles.cannoneyed.com',
        changeOrigin: true,
      },
      // Proxy ADS-B Exchange helicopter data
      '/api/adsb': {
        target: 'https://api.adsb.lol',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/adsb/, '/v2'),
      },
    },
  },
})
