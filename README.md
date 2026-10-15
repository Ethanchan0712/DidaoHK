# 的道 v2.0.71 完整 GitHub 部署包

香港的士叫車 App「的道」完整部署包（完整壓力測試＋3 個 bug 修復）。

## v2.0.71 修復（全部實測發現）
### 🐛 Bug 1：司機出貨單 500 錯誤（嚴重）
- 現象：司機出貨時，如果 `isDirect` 參數係 boolean（舊版 app／特定情況），server 直接 500「伺服器內部錯誤」，張單出唔到。
- 原因：SQLite 唔可以 bind boolean，`isDirect || 'standard'` 會將 boolean true 原封傳入。
- 修復：server normalize `isDirect` 做 string（'standard'/'teishoku'/'discount85' 等），任何格式都安全出單。

### 🐛 Bug 2：後台「今日訂單」計錯（時區錯誤）
- 現象：朝早 0:00-8:00 出嘅單，後台「今日訂單」唔計（顯示 0 或漏計），同「每日訂單」表對唔上。
- 原因：`startOfToday` 計香港日曆日時冇減返 8 小時，令「今日」由朝早 8 點先開始計。
- 修復：正確計香港 00:00 對應嘅 UTC 時間。實測：今日訂單 44＝每日訂單表 44，完全一致 ✅

### 🐛 Bug 3：統計卡「今日訂單」顯示錯數字
- 現象：統計卡「今日訂單」顯示嘅係「總單數」（98），唔係今日單數（44）。
- 原因：前端綁定咗 `totalOrders` 字段，冇用 server 新加嘅 `todayOrders`。
- 修復：統計卡改用 `todayOrders`。實測：顯示 44 ✅

## 完整測試報告（今次做咗）
- ✅ 帳號層：司機註冊（8 位電話）、重複註冊被拒、短密碼被拒、錯密碼被拒、管理員審批、審批後登入、升級會員/取消會員（方案 B 功能）
- ✅ 訂單流程：乘客叫車→司機接單→到達→完成→現金收款→乘客歷史；司機出貨→自己大廳唔見到→司機B接單→完成；出貨者取消自己單
- ✅ 壓力測試：5 乘客同時叫車（64ms）、6 司機同時搶 1 張單（只有 1 個成功，冇重複接單）、3 司機同時出貨、30 張單同時叫車（355ms）、server 壓力後健康
- ✅ 後台全 tab：統計卡（今日訂單修復）、司機審批/已開通、介紹人、皇牌管理、訂單列表、每日訂單（今日 44）、投訴管理、評分總覽、會員列表（共 11 個會員＋升級會員制）
- ✅ 乘客端 UI：叫車成功（POST request 正常）

## 部署方式（Render，GitHub 連線）
1. 將本包 **所有檔案直接覆蓋** 你嘅 GitHub repo（`Ethanchan0712/Didao`）
   ```bash
   git add .
   git commit -m "v2.0.71 修復3個bug（出貨500、今日訂單時區、統計卡字段）"
   git push origin master
   ```
2. Render Web Service 連 GitHub repo，用 `Dockerfile` 部署（runtime: docker）。
3. 環境變數：`PORT=10000`、`DB_PATH=/var/data/taxi.db`（配持久磁碟）。
4. 健康檢查：`/api/health`。

## 驗證部署成功
- `https://<你嘅網址>/api/health` → `{"ok":true,...}`
- 後台統計卡「今日訂單」＝「每日訂單」表今日數字
- **部署完一定要 Ctrl+F5 強制刷新**（清舊 JS 快取）

## 目錄結構
```
dikdou-v2.0.63-github-package/
├─ Dockerfile          # Render 部署
├─ render.yaml         # Render Blueprint（可選）
├─ package.json        # 後端依賴
├─ .env.example        # 環境變數範本
├─ dist/               # 前端 build 成品（四端）
└─ server/             # 後端 code（Express + better-sqlite3 + SSE 實時）
```
