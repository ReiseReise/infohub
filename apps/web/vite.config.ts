import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl = env.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL || ''
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001'

  return {
    define: {
      __API_BASE_URL__: JSON.stringify(apiBaseUrl),
    },
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      host: '0.0.0.0',
      allowedHosts: ['host.docker.internal', '127.0.0.1', 'localhost'],
      proxy: {
        '/api/audio': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/audio/, '/api'),
        },
        '/api/admin': {
          target: 'http://localhost:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/admin/, '/api/admin'),
        },
        '/ws': {
          target: 'ws://localhost:8000',
          ws: true,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/ws/, '/api/ws'),
        },
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
