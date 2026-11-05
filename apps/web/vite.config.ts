import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 開發時把 API 與 WebSocket 轉給本機 wrangler dev（8787）
const SERVER = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    // 開放區域網路連線（手機用 http://192.168.x.x:5173 測試）
    host: true,
    proxy: {
      '/api': SERVER,
      '/parties': { target: SERVER, ws: true },
    },
  },
});
