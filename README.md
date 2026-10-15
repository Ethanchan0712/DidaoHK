# 的道 v2.0.68 完整 GitHub 部署包

香港的士叫車 App「的道」完整部署包。包含最新前端 build（**已修復網頁空白頁 bug**）＋最新後端 code。

## v2.0.68 重點修復
- ✅ **修復網頁開唔到／JS 錯誤（filter crash）**：大廳訂單列表遇到 null／異常資料會成個網頁報錯（iPhone＋電腦都開唔到）。已全面加防禦：所有訂單列表過濾 null 元素，server 返咩怪嘢都唔會再撞。
- ✅ **語音出單講完即時播報**：講完「XX去XX」出單成功即時語音讀「已出單，XX去XX」，唔使講第二次
- ✅ **自己出嘅單唔再當「新單」**：唔會重複播報「新貨單」／彈通知／顯示喺自己大廳
- ✅ **地點座標查詢改並行**：語音出單快咗約一倍
- ✅ **語音出單頁面紅色提示**：「必需講『去』字」
- ✅ **APK 改用原生 TTS**：解決 Samsung 手機「有時有聲有時無聲」問題（WebView 網頁語音唔穩定）
- ✅ **APK 原生通知**：撳「開啟通知」會彈系統視窗，App 閂咗／鎖屏都收到「新貨單」推送
- ✅ **修復「我出嘅單」顯示 bug**：出完單自己即刻喺「貨主」見到（server 記返邊個司機出）
- ✅ **修復網頁空白頁 bug**：`basename` 已改根域名 `"/"`
- ✅ 保留全部功能：新單語音播報（粵語＋女聲開關）、出貨語音落單、備注顯示、客人電話新文案、皇牌詳細規則
- ✅ package.json 補齊全部依賴（express/cors/better-sqlite3/jsonwebtoken/bcryptjs/uuid/ws/web-push）

## 版本內容
- 前端（`dist/`）：Vite build 成品，四端共用（乘客/司機/管理員/租車）
- 後端（`server/`）：Express + better-sqlite3 + WebSocket(實時) + Web Push 推送

## 部署方式（Render，GitHub 連線）
1. 將本包 **所有檔案直接覆蓋** 你嘅 GitHub repo（`Ethanchan0712/Didao`）（唔好成個資料夾搬入去，避免多一層）：
   ```bash
   git add .
   git commit -m "v2.0.68 修復網頁JS錯誤＋語音出單優化"
   git push origin master
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
- 主頁應正常顯示，F12 Console 冇 JS 錯誤；Ctrl+F5 強制刷新（舊 JS 有快取）

## 本機測試
```bash
npm install
node server/index.cjs
# 前端網頁由 dist/ 提供，開 http://localhost:10000
```

## 目錄結構
```
dikdou-v2.0.68-github-package/
├─ Dockerfile          # Render 部署
├─ render.yaml         # Render Blueprint（可選）
├─ package.json        # 後端依賴
├─ .env.example        # 環境變數範本
├─ dist/               # 前端 build 成品（四端，已修復白頁＋JS錯誤）
└─ server/             # 後端 code
   ├─ index.cjs        # 主入口（含 /api/health）
   ├─ db/index.cjs     # better-sqlite3 資料庫
   ├─ routes/          # auth / orders / admin / chat / push / rental
   ├─ middleware/      # auth middleware
   ├─ lib/             # push (Web Push)
   └─ sse/             # Server-Sent Events hub
```
