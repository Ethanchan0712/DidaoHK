# 的道 v2.0.62 完整 GitHub 部署包（含語音播報＋語音落單）

香港的士叫車 App「的道」完整部署包。包含最新前端 build（含**新貨單語音播報**、**出貨語音落單**、**備注顯示**、**客人電話新文案**）＋最新後端 code。

## 版本內容（v2.0.62）
- 前端（`dist/`）：Vite build 成品，四端共用（乘客/司機/管理員/租車）
- 後端（`server/`）：Express + better-sqlite3 + WebSocket(實時) + Firebase FCM 推送
- 新增功能：
  - **新單語音播報**：有新貨單自動讀出「新貨單，上車點，去目的地」（粵語）
  - **靜音開關**：司機設定頁「通知設定 → 新單語音播報」可開關
  - **出貨語音落單**：出貨彈窗上車點/目的地加 🎤 咪按鈕，講地址自動填入
  - **備注顯示**：貨主出貨填嘅備注/額外要求，接單司機卡片會顯示
  - **客人電話新文案**：「客人電話（若不留客人電話系統會留你電話）」

## 部署方式（Render，GitHub 連線）
1. 將本包 push 上你嘅 GitHub repo（`Ethanchan0712/Didao`）：
   ```bash
   git init
   git add .
   git commit -m "v2.0.62 語音播報+語音落單"
   git remote add origin https://github.com/Ethanchan0712/Didao.git
   git push -u origin master
   ```
2. Render 度建立 **Web Service**，連 GitHub repo，用 `Dockerfile` 部署（runtime: docker）。
3. 環境變數（Render 或 `.env`）：
   | Key | 值 |
   |---|---|
   | `PORT` | `10000` |
   | `DB_PATH` | `/var/data/taxi.db`（配合持久磁碟，避免重啟重置資料） |
4. 健康檢查：`/api/health`。

## 本機測試
```bash
npm install
node server/index.cjs
# 前端網頁由 dist/ 提供，開 http://localhost:10000
```

## 目錄結構
```
dikdou-v2.0.62-github-package/
├─ Dockerfile          # Render 部署
├─ render.yaml         # Render Blueprint（可選）
├─ package.json        # 後端依賴（npm install）
├─ .env.example        # 環境變數範本
├─ dist/               # 前端 build 成品（四端）
└─ server/             # 後端 code
   ├─ index.cjs        # 主入口（含 /api/health）
   ├─ db/index.cjs     # better-sqlite3 資料庫
   ├─ routes/          # auth / orders / admin / chat / push / rental
   ├─ middleware/      # auth middleware
   ├─ lib/             # push (FCM)
   └─ sse/             # Server-Sent Events hub
```
