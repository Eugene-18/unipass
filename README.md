# UniPass 校園單一識別系統

前端：React + Vite（部署在 **Vercel**）｜後端：Express + Socket.IO（部署在 **Render**）｜資料庫：Neon PostgreSQL｜金流：藍新 MPG 2.0

## 本機開發

```bash
cd server && npm install && npm run dev      # http://localhost:3000，需要 server/.env
cd client && npm install && npm run dev      # http://localhost:5173，使用 client/.env.development
```

`server/.env` 的欄位請參考 `server/.env.example`。**不要把 `.env` 上傳到 GitHub**（已列在 `.gitignore`）。

## 部署

### 1. 後端（Render）

在 Render 建立 Web Service（或用根目錄的 `render.yaml` 建立 Blueprint）：

| 設定 | 值 |
|---|---|
| Root Directory | `server` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |

環境變數除了 `.env.example` 裡的資料庫、郵件、Google、藍新金鑰外，下列三個網址一定要設成正式網址：

```env
FRONTEND_URL=https://你的專案.vercel.app
NEWEBPAY_RETURN_URL=https://你的後端.onrender.com/api/payment/return
NEWEBPAY_NOTIFY_URL=https://你的後端.onrender.com/api/payment/notify
```

### 2. 前端（Vercel）

匯入 GitHub repo，**Root Directory 選 `client`**（框架會自動辨識為 Vite），並設定環境變數：

```env
VITE_API_URL=https://你的後端.onrender.com
VITE_GOOGLE_CLIENT_ID=530250023370-tjo7gu204m0ai8ok79o8v9qpkd6a8vch.apps.googleusercontent.com
```

`client/vercel.json` 已設定所有路徑導向 `index.html`，因此藍新付款後導回的 `/payment/result` 可以正常開啟。

### 3. Google 登入

到 Google Cloud Console → API 和服務 → 憑證 → OAuth 用戶端，在「已授權的 JavaScript 來源」加入 Vercel 網址。

## 主要流程說明

- **活動報名繳費**：按「我要報名並繳費」→ 後端建立藍新訂單 → 前往藍新付款頁 → 付款完成（或失敗、取消）後，藍新回傳後端 `/api/payment/return`，後端驗證後導回前端 `/payment/result`，前端自動還原登入狀態並**打開該活動的詳情頁**，顯示付款結果。
- **簽到碼**：主辦端的 QR Code 每 **5–12 秒隨機**更新一次，畫面上有倒數；被替換的上一組簽到碼保留 15 秒寬限，學生掃描後才按送出也不會失敗。
- **報名規則**（前後端都會檢查）：報名期間外、名額已滿、活動已刪除都無法報名；付費活動必須先完成繳費才能簽到；完成簽到後才能評分。
- **活動歷程**：完成簽到後會自動顯示；也可以從首頁的「活動歷程」卡片，或活動平台上方的「活動歷程」分頁進入。
- **招生入學登入**：從首頁進入「招生入學」會先看到招生系統登入頁，可選「考生端」或「審查員端」（教職員預設選審查員端）。招生系統的「登出」回到這個登入頁；「返回主畫面／返回首頁」回到 UniPass 首頁並保持登入。審查員端僅限教職員帳號。
- **登入**：已設定密碼（個人資料頁或忘記密碼流程）的帳號登入時會驗證密碼；尚未設定密碼的展示帳號維持免密碼登入。
- **AI 活動推薦**（`server/src/services/activityRecommendation.service.ts`）：不需要另外維護資料。每個活動依「類別」（再加上標題關鍵字）自動換算成五項能力標籤（程式邏輯、商業企劃、團隊溝通、美感設計、數據分析）；學生的能力分數由他自己報名、簽到、評分過的活動加權計算（簽到 ×2，評分越高權重越高），首頁雷達圖顯示的就是這組分數。推薦清單用餘弦相似度比對學生分數與「尚未參加、仍可報名、未額滿」的活動，取前 5 名；還沒有任何參與紀錄的帳號則改為顯示熱門活動。

## 檢查指令

```bash
cd server && npx tsc --noEmit && npm run build
cd client && npx tsc -b && npx eslint . && npm run build
```
