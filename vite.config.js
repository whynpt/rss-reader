import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 与 server/index.js 用同一个环境变量，换端口时前后端一起生效
const API_PORT = process.env.PORT || 8787;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    // 开发时前端与 API 分端口运行，这里把 /api 转发给 Express
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
