# 的道 DidaoHK v2.0.79 完整部署包

> 版本：v2.0.79（versionCode：2079）
> 香港的士叫車 App：乘客 + 司機 + 管理員 + 租車 四端
> 部署目標：Render（Docker）+ Android APK/AAB（Capacitor）

---

## 🆕 v2.0.79 今次更新

### 1. iOS PWA 語音播報修復（重點！）
- **問題**：iPhone 用 Chrome「加到主畫面」開啟 PWA，新單語音播報出現「第一張無聲、第二張有聲、再無聲……」交替失效
- **原因**：iOS speechSynthesis 對「連續 cancel → 立即 speak」極敏感，會令語音引擎進入壞狀態；加上 PWA 啟動初期未有用戶互動解鎖語音授權
- **修復**：
  1. 播報鎖（上一次播報未完，新播報自動延後 300ms 再試，唔疊播、唔跳過）
  2. cancel 之後延遲 200ms 再 speak，俾 iOS 引擎重置
  3. 司機大廳首次用戶互動（撳／掂）即自動解鎖語音引擎
- **注意**：升級後喺 iPhone 要**刪除舊主畫面捷徑 → 重新加到主畫面**，入司機大廳後隨便撳一下先開始接單

### 2. 版本號統一為 2.0.79
- 前端三語（繁中/英文/日文）顯示版本統一改做「版本 2.0.79 · 示範版」——解決之前界面顯示舊版本號嘅問題
- Android versionCode 2079 / versionName 2.0.79

---

## ✅ v2.0.78 已包含功能（全部保留）
1. 新單粵語 TTS 播報強化：語音設定面板（總開關／只播皇牌單／重複 1~3 次）
2. 司機搶單成功「叮咚」音效
3. 皇牌單優先排序（永遠排最頂，👑 標記）
4. 皇牌單 10 秒鎖定派單（鎖定期淨係皇牌司機接到，10 秒後自動開放；**冇做訂單自動過期**，預約單完全保留）
5. 司機評分 + 拒單率統計（拒單率 = 拒單 ÷ (接單+拒單)）：司機大廳 >40% 紅色警告 + 管理員後台顯示
6. 原有四端全部功能：地圖、驗證碼登入、貨主出單、打賞、FCM 通知、租車等

---

## 🚀 Render 部署步驟

1. 將 `dikdou-v2.0.79-github-package` 成個資料夾推上 GitHub repo（或手動上傳 Render）
2. Render 建立 Web Service：
   - Runtime: **Docker**
   - Dockerfile 路徑: `./Dockerfile`
   - Health Check Path: `/api/health`
3. 環境變數：
   - `PORT` = `10000`
   - `DB_PATH` = `/var/data/taxi.db`
4. 掛載 Persistent Disk：mount `/var/data`（1GB 已夠）
5. Deploy，完成後開網站 Ctrl+F5 強制刷新，確認版本 v2.0.79

> ✅ 後端啟動會自動做 DB migration（PRAGMA 檢查欄位唔存在先加），**唔使人手執 SQL**
> ✅ 已有 Persistent Disk 數據（舊司機/單）會原封保留，欄位自動補齊

---

## 📱 Android APK / AAB 打包

部署包唔包含 Android 原生工程（避免過大）。用你本機嘅 `dikdou-app` 項目（同一份源碼已合併）：

```bash
npm install
npm run build
npx cap sync android
```

- APK：Android Studio → Build → Build APK
- AAB（Google Play）：Build → Generate Signed Bundle / APK → Android App Bundle（用你嘅 keystore 簽名，versionCode 2079）

---

## 📦 包結構

```
dikdou-v2.0.79-github-package/
├─ Dockerfile          # Render Docker 部署配置
├─ render.yaml         # Render Blueprint（可選）
├─ package.json        # 後端依賴（Express + better-sqlite3 + SSE + FCM）
├─ dist/               # 前端靜態檔（Vite build 產物，網頁版直接 serve）
└─ server/             # 後端完整源碼
   ├─ index.cjs        # 入口（自動 migration + SPA serve）
   ├─ db/index.cjs     # 資料庫 schema + 自動加欄位
   ├─ routes/          # auth / orders / admin / rental / chat / push
   ├─ middleware/      # JWT 權限
   ├─ sse/             # 即時推送（接單大廳）
   ├─ lib/             # FCM push
   └─ privacy.html / delete-account.html / assetlinks.json
```

---

## ⚠️ 已知系統限制
- iPhone PWA（加到主畫面）：語音引擎受 iOS 系統政策限制，升級後記得重新加主畫面捷徑，並喺司機大廳先撳一下頁面解鎖
- iOS Safari：Apple autoplay 限制嚴格，TTS 有機會被系統靜默封鎖（系統安全政策，非程式 bug），有水滴聲 + Toast 做後備
- Android WebView：司機登入後撳過頁面任何制，解鎖語音授權，TTS 先穩定出聲
- 管理員帳號：admin / lovevivi815（後端啟動 log 會顯示）
