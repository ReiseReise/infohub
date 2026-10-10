import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl = env.VITE_API_BASE_URL || process.env.VITE_API_BASE_URL || ''
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001'

  return {
    define: {
      __API_BASE_URL__: JSON.stringify(apiBaseUrl),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          name: '信息中枢',
          short_name: '信息中枢',
          description: '全渠道信息管道系统',
          theme_color: '#0d9488',
          background_color: '#f7f8f6',
          display: 'standalone',
          scope: '/',
          start_url: '/',
          icons: [
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-ui': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-popover',
              '@radix-ui/react-tabs',
              '@radix-ui/react-tooltip',
              '@radix-ui/react-slot',
              '@radix-ui/react-separator',
              '@radix-ui/react-switch',
              '@radix-ui/react-select',
            ],
            'vendor-markdown': ['react-markdown', 'remark-gfm', 'rehype-sanitize'],
            'vendor-motion': ['framer-motion'],
            'vendor-virtual': ['@tanstack/react-virtual'],
            'vendor-charts': ['recharts'],
          },
        },
      },
    },
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
