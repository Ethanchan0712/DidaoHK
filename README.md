# 的道 v2.0.63 完整 GitHub 部署包

香港的士叫車 App「的道」完整部署包。包含最新前端 build（**已修復網頁空白頁 bug**）＋最新後端 code。

## v2.0.63 重點修復
- ✅ **修復網頁空白頁 bug**：舊版 build 入面 `basename` 被部署環境塞入字面字串 `{{basename}}`，導致 router 匹配唔到 URL → 白頁。已改為根域名直接 `"/"`，重新 build。
- ✅ 保留全部新功能：新單語音播報（粵語）、出貨語音落單、備注顯示、客人電話新文案
- ✅ package.json 補齊全部依賴（express/cors/better-sqlite3/jsonwebtoken/bcryptjs/uuid/ws/web-push）

## 版本內容
- 前端（`dist/`）：Vite build 成品，四端共用（乘客/司機/管理員/租車）
- 後端（`server/`）：Express + better-sqlite3 + WebSocket(實時) + Web Push 推送

## 部署方式（Render，GitHub 連線）
1. 將本包 push 上你嘅 GitHub repo（`Ethanchan0712/Didao`）：
   ```bash
   git init
   git add .
   git commit -m "v2.0.63 修復網頁空白頁 bug"
   git remote add origin https://github.com/Ethanchan0712/Didao.git
   git push -u origin master
   ```
2. Render 度建立 **Web Service**，連 GitHub repo，用 `Dockerfile` 部署（runtime: docker）。
3. 環境變數：
   | Key | 值 |
   |---|---|
   | `PORT` | `10000` |
   | `DB_PATH` | `/var/data/taxi.db`（配持久磁碟，避免重啟重置資料） |
4. 健康檢查：`/api/health`。

## 驗證部署成功
- 訪問 `https://<你嘅網址>/api/health` → 應返回 `{"ok":true,...}`
- 主頁應正常顯示（唔再空白），F12 Console 唔再有 `{{basename}}` 警告

## 本機測試
```bash
npm install
node server/index.cjs
# 前端網頁由 dist/ 提供，開 http://localhost:10000
```

## 目錄結構
```
dikdou-v2.0.63-github-package/
├─ Dockerfile          # Render 部署
├─ render.yaml         # Render Blueprint（可選）
├─ package.json        # 後端依賴
├─ .env.example        # 環境變數範本
├─ dist/               # 前端 build 成品（四端，已修復白頁）
└─ server/             # 後端 code
   ├─ index.cjs        # 主入口（含 /api/health）
   ├─ db/index.cjs     # better-sqlite3 資料庫
   ├─ routes/          # auth / orders / admin / chat / push / rental
   ├─ middleware/      # auth middleware
   ├─ lib/             # push (Web Push)
   └─ sse/             # Server-Sent Events hub
```
