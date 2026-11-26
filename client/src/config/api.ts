export const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://unipass-j78u.onrender.com';
export const API_ORIGIN = API_BASE_URL.replace(/\/+$/, '');

// Google OAuth 用戶端 ID 是公開資訊（會出現在瀏覽器中），後端也以同一組 ID 驗證登入。
// 部署平台未設定 VITE_GOOGLE_CLIENT_ID 時使用預設值，避免 Google 登入按鈕消失。
export const GOOGLE_CLIENT_ID: string =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
  '530250023370-tjo7gu204m0ai8ok79o8v9qpkd6a8vch.apps.googleusercontent.com';
