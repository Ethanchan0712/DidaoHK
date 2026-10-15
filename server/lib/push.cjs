// Web Push 推播：有單時發推送俾所有允許通知嘅司機
const webpush = require('web-push');

const VAPID = {
  publicKey: process.env.VAPID_PUBLIC_KEY || 'BM1koz1hApejxB1ma_vkauFTe3DSjRjZP5HEDI06bgvlVM0doGGarZA3avOYQQ-bZ3zKLPDqIXMzvcArYpr-zqo',
  privateKey: process.env.VAPID_PRIVATE_KEY || 'lEqi3GVJvY3Q3hVsX8XvCLZABILiF5fbGzk0L32djj8',
  subject: process.env.VAPID_SUBJECT || 'mailto:tkdw0712@gmail.com',
};

try {
  webpush.setVapidDetails(VAPID.subject, VAPID.publicKey, VAPID.privateKey);
} catch (e) {
  console.warn('[push] VAPID 設定失敗:', e.message);
}

const MAX_TTL = 300; // 5 分鐘：單只推一次，過期唔重推

// 計兩點直線距離（公里，Haversine）
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 發送新單推播俾所有司機（opts.title 可自訂標題，例如出貨單用「新貨單！」）
async function sendNewOrderPush(db, order, opts = {}) {
  const subs = db.getAllPushSubscriptions();
  if (!subs || subs.length === 0) return { sent: 0 };

  const title = opts.title || '🚕 新單！';
  const pickup = order.pickup?.name || order.pickupName || '上車地點';
  const dest = order.destination?.name || order.destinationName || '目的地';
  const fare = order.estimatedFare || order.estimated_fare || 0;
  // 費用 0（地點解析唔到／跳錶不定價）→ 唔顯示「約 HK$0」誤導，改顯示「跳錶」
  const fareText = fare > 0 ? `約 HK$${fare}` : '跳錶';
  const pLat = order.passengerLat ?? order.pickup?.lat;
  const pLng = order.passengerLng ?? order.pickup?.lng;

  const results = { sent: 0, failed: 0, errors: [] };
  for (const sub of subs) {
    if (!sub.endpoint) continue;
    try {
      // 逐個司機計「距你幾多公里 + 預計幾多分鐘」（市區平均約 25km/h → 每公里約 2.4 分鐘）
      let extra = '';
      if (sub.driver_id && typeof pLat === 'number' && typeof pLng === 'number') {
        const d = db.prepare('SELECT current_lat, current_lng FROM drivers WHERE id = ?').get(sub.driver_id);
        if (d && typeof d.current_lat === 'number' && typeof d.current_lng === 'number') {
          const dist = haversineKm(d.current_lat, d.current_lng, pLat, pLng);
          const etaMin = Math.max(1, Math.round(dist * 2.4));
          extra = ` ｜ 距你 ${dist.toFixed(1)}km · 約 ${etaMin}分鐘`;
        }
      }
      const payload = JSON.stringify({
        title,
        body: `${pickup} → ${dest} ｜ ${fareText}${extra}`,
        data: { orderId: order.id, pickup, dest, fare },
        // 傳埋導航目標俾 SW 跳去對應單
        url: '/driver/hall',
      });
      const pushSub = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
      };
      await webpush.sendNotification(pushSub, payload, { TTL: MAX_TTL });
      results.sent += 1;
    } catch (e) {
      results.failed += 1;
      // 410/404：訂閱已失效（司機清咗通知／browser 過期）——自動清除
      if (e.statusCode === 410 || e.statusCode === 404 || (e.statusCode >= 400 && e.statusCode < 500)) {
        db.removePushSubscription(sub.endpoint);
      } else if (results.errors.length < 3) {
        results.errors.push(e.message);
      }
    }
  }
  if (results.failed > 0) {
    console.log(`[push] 新單 ${order.id}: 成功 ${results.sent} / 失敗 ${results.failed}`, results.errors.join(' | '));
  } else {
    console.log(`[push] 新單 ${order.id}: 成功 ${results.sent}`);
  }
  return results;
}

// 發送「司機接到單」確認推播（可選）
async function sendOrderUpdatePush(db, order, title, body) {
  const subs = db.getAllPushSubscriptions();
  if (!subs || subs.length === 0) return { sent: 0 };
  const payload = JSON.stringify({ title, body, data: { orderId: order.id }, url: '/driver/current' });
  const results = { sent: 0, failed: 0 };
  for (const sub of subs) {
    if (!sub.endpoint) continue;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
        payload,
        { TTL: MAX_TTL }
      );
      results.sent += 1;
    } catch (e) {
      results.failed += 1;
      if (e.statusCode === 410 || e.statusCode === 404) db.removePushSubscription(sub.endpoint);
    }
  }
  return results;
}

module.exports = { VAPID, sendNewOrderPush, sendOrderUpdatePush };
