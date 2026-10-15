# 的道 v2.0.69 完整 GitHub 部署包

香港的士叫車 App「的道」完整部署包。包含最新前端 build＋最新後端 code。

## v2.0.69 重點修復（完整測試後）
- ✅ **後台「今日訂單」口徑修正**：改為香港日曆日（00:00 起）計數，同「每日訂單」表一致（之前用 24 小時滾動窗口，數字對唔上）
- ✅ **後台 tab 切換即時載入**：訂單列表／每日訂單／投訴／評分，撳入即時出數據，唔使等 10 秒 polling
- ✅ **後台「會員列表」優化**：加搜尋（司機名／帳號／車牌／電話）、載入中狀態、清楚提示「顯示全部司機帳戶，搵唔到請去司機管理」
- ✅ **司機「我出嘅單」徹底過濾**：自己出嘅單（包括 reload 之後）唔再顯示喺自己大廳、唔再重複播報「新貨單」（修復「我出咗單但自己大廳見到／出單要講第二次先播報」）
- ✅ 全部端完整測試通過：乘客叫車、司機出貨／接單／行程、管理員後台所有 tab、租車列表
- ✅ 之前修復全保留：網頁 JS 錯誤（filter null 防禦）、`myPostedIdsRef` TDZ 錯誤、語音出單即時播報、原生 TTS 女聲、原生通知、座標並行加速、紅色「必需講『去』字」提示

## 版本內容
- 前端（`dist/`）：Vite build 成品，四端共用（乘客/司機/管理員/租車）
- 後端（`server/`）：Express + better-sqlite3 + WebSocket(實時) + Web Push 推送

## 部署方式（Render，GitHub 連線）
1. 將本包 **所有檔案直接覆蓋** 你嘅 GitHub repo（`Ethanchan0712/Didao`）（唔好成個資料夾搬入去，避免多一層）：
   ```bash
   git add .
   git commit -m "v2.0.69 完整測試修復後台＋司機大廳過濾"
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
- 主頁應正常顯示，F12 Console 冇 JS 錯誤；**部署完一定要 Ctrl+F5 強制刷新**（清舊 JS 快取）

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
├─ dist/               # 前端 build 成品（四端）
└─ server/             # 後端 code
   ├─ index.cjs        # 主入口（含 /api/health）
   ├─ db/index.cjs     # better-sqlite3 資料庫
   ├─ routes/          # auth / orders / admin / chat / push / rental
   ├─ middleware/      # auth middleware
   ├─ lib/             # push (Web Push)
   └─ sse/             # Server-Sent Events hub
```
