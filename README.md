# 的道 v2.0.76 GitHub 部署包

## v2.0.76 全量優化（16 項）
### 你投訴嘅 2 個核心 bug
1. 🎙️ TTS「10次得1次有聲」→ safeSpeak：播報前強制 cancel + pause/resume 喚醒卡死引擎 + onend/onerror 監聽 + 12 秒超時重置；撳 Mic／出一張新單嗰刻預先 unlockSpeech 攞 autoplay 授權
2. ❌ 取消按鈕「撳兩下＋閃一下」→ 單擊即 loading「取消中…」鎖，API 成功後先 refresh（唔再中途重渲染）

### 其他優化
3. 取消單即時解除 3 分鐘防重鎖（取消完可以即刻再出同路線）
4. 接單／拒絕按鈕加「接單中…／拒絕中…」loading 鎖，防雙撳
5. 出貨 badge＝只計 searching（等緊接）單；接貨 badge 由過濾後列表實計
6. 修復 PostOrderSheet 跨 scope 用 myPostedIdsRef 嘅隱藏 crash（出單成功後可能誤報「失敗」）
7. 後端接單鎖校驗：皇牌即時/VIP 10 秒/普通 30 秒，防繞過前端搶單（403）
8. 全局斷網橫幅「網絡唔穩定／離線中」
9. 401 登入過期自動清 token 跳登入頁（已有）＋ vibration iOS 兼容（已有 try/catch）
10. 列表 key 統一 orderId（防 polling 重複卡片）
11. 里程標「約」字（估算）
12. index.html no-cache（部署後版本號即時更新）
13. GPS 定位狀態綠點／灰點
14. 通知紅點「全部已讀」清零（已有）
15. JWT 30 日有效期（已有）
16. 語音出單後自己單唔會當「新單」播報（server hall 已過濾）

## 部署（重要：今次有後端改動，要成包 push）
1. 成個部署包覆蓋 GitHub repo → commit「v2.0.76 全量優化＋後端鎖」→ push
2. Render 自動部署（前端+後端一齊更新，唔可以淨更新前端）
3. 部署完 Ctrl+F5（手機關 app 再開）
4. 驗證：didaohk.com 底部「版本 2.0.76」

# 的道 v2.0.75 GitHub 部署包

## v2.0.75 修復：出貨 tab 只顯示仲等緊接嘅單
- 「出貨」tab 嘅「我出嘅單」而家淨係顯示 searching（仲等緊接）嘅單
- 已經俾人接咗/完成咗/取消咗嘅單唔會留喺「出貨」度（數字 badge 一齊少返）
- 想睇已處理單狀態（邊個接咗/車牌/電話）→ 「貨主」tab
- 附帶（上一版 2.0.74）：重複顯示根治——「我出嘅單」連網讀 server 真數據，唔再讀 localStorage 假單；429 防重唔再寫假單

## 部署方式
1. 覆蓋 GitHub repo → commit「v2.0.75 出貨淨顯示等緊接單」→ push
2. Render 自動部署 → 部署完 Ctrl+F5 / 手機關 app 再開
3. 驗證：didaohk.com 底部「版本 2.0.75」

# 的道 v2.0.74 完整 GitHub 部署包

## v2.0.74 修復：重複出單（真正根治——顯示重複）
### 真正原因（今次查到底）
- server 其實冇出兩張單（接貨得 1 張＝server 得 1 張）
- 「我出嘅單」顯示 2 張＝前端讀 localStorage fallback 假單：出單 API 被 3 分鐘防重擋（429）時，前端仍然寫入 localStorage 假單（POSTxxx）並顯示 → 呃咗司機以為出咗兩張

### 修復（三點）
1. 「我出嘅單」連網時讀 server /orders/driver/my-posted（真實數據）——唔再讀 localStorage 假單
2. 出單 API 被 3 分鐘防重擋（429）→ 唔好 fallback 寫假單，直接提示「你啱啱先出過相同路線單」
3. server 出單成功 → 唔寫本地大廳假單（server 自己廣播）

### 效果
- 再出單只會出現 1 張（server 真單）
- 舊 localStorage 假單唔會再顯示

## 部署方式
1. 覆蓋 GitHub repo（Ethanchan0712/Didao）→ commit「v2.0.74 根治重複顯示」→ push
2. Render 自動部署
3. 部署完 Ctrl+F5（手機關 app 再開）
4. 驗證：didaohk.com 底部「版本 2.0.74」

# 的道 v2.0.73 完整 GitHub 部署包

## v2.0.73 修復：重複出單（根治）
### 真正原因
- 語音出單成功後，手機 TTS 播報有時無聲 → 司機以為冇出到單 → 再講多次 → 兩張單
- 之前 server 防重只有 8 秒，擋唔到相隔 1 分鐘嘅重複操作

### 修復（三重防線）
1. **server 防重拉長**：同一司機 180 秒（3 分鐘）內唔可以出相同路線單
   - 實測：第一次成功 ✅｜即時重複被擋 ✅｜另一司機相同路線正常 ✅｜唔同路線正常 ✅
2. **前端語音出單成功回饋**：出單成功即時「已出單」語音＋手機震動 250ms（TTS 無聲都知成功）
3. **前端成功後 10 秒鎖**：語音出單成功後 10 秒內鎖住（防止以為失敗再講多次）；失敗即刻解鎖可以再試

## 部署方式
1. 將本包所有檔案直接覆蓋 GitHub repo（Ethanchan0712/Didao）→ commit「v2.0.73 根治重複出單」→ push
2. Render 自動部署
3. 部署完 Ctrl+F5（手機關 app 再開）
4. 驗證：https://didaohk.com 底部顯示「版本 2.0.73」

## 之前版本修復記錄
- v2.0.72：語音出單 busy 鎖＋server 8 秒防重（未根治，今次拉長）
- v2.0.71：司機出貨 500 錯誤、後台今日訂單時區錯、統計卡顯示總單數、會員列表顯示全部司機＋一鍵升級會員
