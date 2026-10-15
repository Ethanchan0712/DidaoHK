# 的道 v2.0.70 完整 GitHub 部署包

香港的士叫車 App「的道」完整部署包。包含最新前端 build＋最新後端 code。

## v2.0.70 新功能：後台「會員列表」顯示所有人＋一鍵升級會員
- ✅ **會員列表而家顯示全部已註冊司機帳戶**（普通司機＋會員＋皇牌都見到），唔再淨係顯示付費會員（之前「共 0 個會員」令人以為無晒人）
- ✅ **每行新增「升級會員」按鈕**：撳開會展開有效期（1／3／6／12 個月／永久），揀完「確認升級」即時將嗰個司機升級做會員（VIP），佢會出現 VIP 徽章＋「取消會員」按鈕
- ✅ 與「升皇牌／取消皇牌」「開通營運主任」並排，全部一頁搞掂
- ✅ 搜尋功能保留（司機名／帳號／車牌／電話）
- ✅ 提示文字更新：「想升級某個司機做會員（VIP）或皇牌，直接撳右邊按鈕」

## v2.0.69 重點修復（全保留）
- 後台「今日訂單」改香港日曆日計數，同「每日訂單」表一致
- 後台 tab 切換即時載入（訂單／每日訂單／投訴／評分）
- 司機「我出嘅單」徹底過濾（自己出嘅單唔再喺自己大廳／唔再重複播報）
- 網頁 JS 錯誤、語音出單即時播報、原生 TTS 女聲、原生通知等全部保留

## 部署方式（Render，GitHub 連線）
1. 將本包 **所有檔案直接覆蓋** 你嘅 GitHub repo（`Ethanchan0712/Didao`）
   ```bash
   git add .
   git commit -m "v2.0.70 會員列表顯示全部司機＋後台一鍵升級會員"
   git push origin master
   ```
2. Render Web Service 連 GitHub repo，用 `Dockerfile` 部署（runtime: docker）。
3. 環境變數：`PORT=10000`、`DB_PATH=/var/data/taxi.db`（配持久磁碟）。
4. 健康檢查：`/api/health`。

## 驗證部署成功
- `https://<你嘅網址>/api/health` → `{"ok":true,...}`
- 後台 → 會員列表：應見到所有司機＋「升級會員」按鈕
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
