import { defineConfig } from 'vite';
import path from 'node:path';

const standaloneBuild = process.env.VISTARA_BUILD_TARGET === 'standalone';

export default defineConfig({
  root: path.resolve(__dirname),
  publicDir: 'public',
  build: {
    outDir: standaloneBuild
      ? path.resolve(__dirname, 'dist')
      : path.resolve(__dirname, '..', 'dist'),
    emptyOutDir: true,
    rollupOptions: {
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
