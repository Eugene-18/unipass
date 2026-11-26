import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 大型第三方套件各自拆成獨立檔案，可被瀏覽器長期快取，首頁也不必一次下載全部
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['chart.js', 'react-chartjs-2'],
          mathjs: ['mathjs'],
          pdf: ['jspdf', 'html-to-image'],
          scanner: ['@yudiel/react-qr-scanner'],
          realtime: ['socket.io-client'],
        },
      },
    },
    // mathjs（招生成績公式計算）本身約 650 kB，只在進入招生系統時載入
    chunkSizeWarningLimit: 700,
  },
})
