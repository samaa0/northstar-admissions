import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Serial files avoid worker coordination stalls in the iCloud-hosted project folder.
    fileParallelism: false,
    maxWorkers: 1,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
