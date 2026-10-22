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

// ===== v2.1.0：App（FCM）推送——有 FCM_SERVICE_ACCOUNT（service account JSON）先啟用 =====
let fcmApp = null;
let fcmWarned = false;
function getFcmApp() {
  if (fcmApp) return fcmApp;
  const credJson = process.env.FCM_SERVICE_ACCOUNT;
  if (!credJson) {
    if (!fcmWarned) {
      console.warn('[fcm] 未設定 FCM_SERVICE_ACCOUNT——App（FCM）推送未啟用（Web Push 照常）');
      fcmWarned = true;
    }
    return null;
  }
  try {
    const admin = require('firebase-admin');
    fcmApp = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(credJson)) });
    console.log('[fcm] Firebase 已初始化——App 推送啟用');
    return fcmApp;
  } catch (e) {
    console.warn('[fcm] 初始化失敗:', e.message);
    return null;
  }
}

async function sendFcmToDrivers(db, order, opts = {}) {
  const app = getFcmApp();
  if (!app) return { fcm: 'disabled' };
  const tokens = db.getAllFcmTokens();
  if (!tokens || tokens.length === 0) return { fcm: 0 };
  // v2.1.9：token 去重——同一部機／同一 token 重複註冊時只推一次，避免重複通知
  const uniqueTokens = [...new Map(tokens.map((t) => [t.token, t])).values()];
  const title = opts.title || '🚕 新單！';
  const pickup = order.pickup?.name || order.pickupName || '上車地點';
  const dest = order.destination?.name || order.destinationName || '目的地';
  const fare = order.estimatedFare || order.estimated_fare || 0;
  const fareText = fare > 0 ? `約 HK$${fare}` : '跳錶';
  // v2.1.11：預約單通知帶時間（第一句：10月25日 下午3點）
  const sched = order.scheduledAt ? schedTxt(order.scheduledAt) : '';
  const schedPrefix = sched ? `預約單：${sched}，` : '';
  const message = {
    tokens: uniqueTokens.map((t) => t.token),
    notification: { title: sched ? `🕒 預約單！` : title, body: `${schedPrefix}${pickup} → ${dest} ｜ ${fareText}` },
    data: {
      orderId: order.id, pickup, dest, fare: String(fare), url: '/driver/hall',
    },
    android: { priority: 'high', notification: { channelId: 'new-order', sound: 'default' } },
  };
  try {
    const r = await app.messaging().sendEachForMulticast(message);
    // 失效 token 自動清走
    r.responses.forEach((resp, i) => {
      if (!resp.success && uniqueTokens[i]) db.removeFcmToken(uniqueTokens[i].token);
    });
    return { fcm: r.successCount };
  } catch (e) {
    console.warn('[fcm] 發送失敗:', e.message);
    return { fcm: 0 };
  }
}

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

// v2.1.11：預約單時間文字（如「10月25日 下午3點」）——通知第一句用
function schedTxt(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const h24 = d.getHours();
  const ampm = h24 < 12 ? '上午' : '下午';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${d.getMonth() + 1}月${d.getDate()}日${ampm}${h12}點`;
}

// 發送新單推播俾所有司機（opts.title 可自訂標題，例如出貨單用「新貨單！」）
async function sendNewOrderPush(db, order, opts = {}) {
  const subs = db.getAllPushSubscriptions();
  if (!subs || subs.length === 0) return { sent: 0 };
  // v2.1.9：endpoint 去重——同一部機重複註冊（重裝/多開）時只推一次，避免重複通知
  const uniqueSubs = [...new Map(subs.filter((s) => s.endpoint).map((s) => [s.endpoint, s])).values()];

  const title = opts.title || '🚕 新單！';
  const pickup = order.pickup?.name || order.pickupName || '上車地點';
  const dest = order.destination?.name || order.destinationName || '目的地';
  const fare = order.estimatedFare || order.estimated_fare || 0;
  // 費用 0（地點解析唔到／跳錶不定價）→ 唔顯示「約 HK$0」誤導，改顯示「跳錶」
  const fareText = fare > 0 ? `約 HK$${fare}` : '跳錶';
  // v2.1.11：預約單通知帶時間（第一句：10月25日 下午3點）＋標題改「🕒 預約單！」
  const sched = order.scheduledAt ? schedTxt(order.scheduledAt) : '';
  const schedPrefix = sched ? `預約單：${sched}，` : '';
  const pLat = order.passengerLat ?? order.pickup?.lat;
  const pLng = order.passengerLng ?? order.pickup?.lng;

  const results = { sent: 0, failed: 0, errors: [] };
  for (const sub of uniqueSubs) {
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
      const note = order.passengerNotes?.customNote || '';
      // 備註/額外要求：有就拼入通知 body，其他司機收推送時直接睇到
      const noteText = note ? ` ｜ 📋${note}` : '';
      const payload = JSON.stringify({
        title: sched ? `🕒 預約單！` : title,
        body: `${schedPrefix}${pickup} → ${dest} ｜ ${fareText}${extra}${noteText}`,
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
  // v2.1.0：App（FCM）推送——fire-and-forget，同 Web Push 並行
  sendFcmToDrivers(db, order, opts).catch(() => {});
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

module.exports = { VAPID, sendNewOrderPush, sendOrderUpdatePush, sendFcmToDrivers };
