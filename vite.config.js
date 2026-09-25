import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE || '/avalanche/ecosystem/',
  plugins: [react()],
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    port: 5176,
    proxy: {
      '/api': 'http://127.0.0.1:8876',
      '/avalanche/ecosystem/api': 'http://127.0.0.1:8876',
    },
  },
});
