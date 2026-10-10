import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Independent entry permits an additive release without replacing existing pages.
export default defineConfig({
  base:'/api/radius-ui/',define:{__API_BASE_URL__:JSON.stringify('')},
  plugins:[react(),tailwindcss()],
  build:{outDir:process.env.RADIUS_WEB_OUTPUT||'/private/tmp/infohub-radius-web',emptyOutDir:true,rollupOptions:{input:'standalone/radius.html'}},
});
