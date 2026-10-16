# 的道 DidaoHK v2.0.78 完整部署包

> 版本：v2.0.78（versionCode：2078）
> 香港的士叫車 App：乘客 + 司機 + 管理員 + 租車 四端
> 部署目標：Render（Docker）+ Android APK/AAB（Capacitor）

---

## 🆕 v2.0.78 今次新增功能

### 1. 新單粵語 TTS 播報（司機端）
- 在線司機收到新單 → 先響「叮」提示聲，再粵語讀出：上車點、目的地、全程公里、距離你幾遠、車種（皇牌單會讀「皇牌單」）
- 語音設定面板（⚙️ 按鈕）：
  - 新單語音播報總開關
  - **只播皇牌單**（普通單唔讀，淨係讀皇牌直單）
  - **重複播報次數**（1 / 2 / 3 次，錯過都聽多次）
  - 設定自動儲存（localStorage），下次登入記住
- `seenOrderIdsRef` 防重複播報（polling 唔會同一張單重複讀）
- 保留貨主出單成功「已出單」TTS 播報

### 2. 搶單成功音效
- 司機接單成功嗰刻，即時響「叮咚」成功提示音（Web Audio，iOS/Android 都播到）

### 3. 皇牌單優先排序
- 接貨大廳：**皇牌單（皇牌直單）永遠排最頂**，之後先按新單優先
- 單卡顯示 👑 皇牌單 標記

### 4. 皇牌單 10 秒鎖定派單
- 皇牌直單出單後，**10 秒皇牌鎖定期**：淨係皇牌(VVIP)司機見到同接到
- 10 秒到期自動解鎖，開放俾所有司機
- 普通司機喺鎖定期內撳接單，後端會擋：「呢張皇牌單仲喺皇牌司機鎖定期（10秒）」

### 5. 司機評分 + 拒單率統計
- 後端 DB 自動加欄位：`drivers.reject_count`、`drivers.total_accept_count`
- 接單成功 → 接單次數 +1；撳拒絕 → 拒單次數 +1
- 拒單率 = 拒單次數 ÷（接單次數 + 拒單次數）
- 司機大廳：拒單率超過 **40%** 會彈紅色警告橫額
- 管理員後台會員列表：顯示 ⭐評分、接單數、拒單數、拒單率%（超過 40% 紅色閃動標記）

### 冇改動 / 保留
- 預約單完全保留，**冇做訂單自動過期**
- 冇做司機上線心跳（留 v2.0.79+）
- 原有四端全部功能、地圖、驗證碼登入、貨主出單、打賞、推送通知全部保留

---

## 🚀 Render 部署步驟

1. 將 `dikdou-v2.0.78-github-package` 成個資料夾推上 GitHub repo（或手動上傳 Render）
2. Render 建立 Web Service：
   - Runtime: **Docker**
   - Dockerfile 路徑: `./Dockerfile`
   - Health Check Path: `/api/health`
3. 環境變數：
   - `PORT` = `10000`
   - `DB_PATH` = `/var/data/taxi.db`
4. 掛載 Persistent Disk：mount `/var/data`（1GB 已夠）
5. Deploy，完成後開網站 Ctrl+F5 強制刷新，確認版本 v2.0.78

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
- AAB（Google Play）：Build → Generate Signed Bundle / APK → Android App Bundle（用你嘅 keystore 簽名）

---

## 📦 包結構

```
dikdou-v2.0.78-github-package/
├─ Dockerfile          # Render Docker 部署配置
├─ render.yaml         # Render Blueprint（可選）
├─ package.json        # 後端依賴（Express + better-sqlite3 + SSE + FCM）
├─ dist/               # 前端靜態檔（Vite build 產物，網頁版直接 serve）
└─ server/             # 後端完整源碼
   ├─ index.cjs        # 入口（自動 migration + SPA serve）
   ├─ db/index.cjs     # 資料庫 schema + v2.0.78 自動加欄位
   ├─ routes/          # auth / orders / admin / rental / chat / push
   ├─ middleware/      # JWT 權限
   ├─ sse/             # 即時推送（接單大廳）
   ├─ lib/             # FCM push
   └─ privacy.html / delete-account.html / assetlinks.json
```

---

## ⚠️ 已知系統限制
- Android WebView：司機登入後撳過頁面任何制，解鎖語音授權，TTS 先穩定出聲
- iOS Safari：Apple autoplay 限制嚴格，TTS 有機會被系統靜默封鎖（系統安全政策，非程式 bug），有水滴聲 + Toast 做後備
- 管理員帳號：admin / lovevivi815（後端啟動 log 會顯示）
