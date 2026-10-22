const express = require('express');
const db = require('../db/index.cjs');
const sseHub = require('../sse/hub.cjs');
const { authPassenger, authDriver, authAdmin, authAny } = require('../middleware/auth.cjs');
const { rateLimit } = require('../middleware/rate-limit.cjs');
const { sendNewOrderPush } = require('../lib/push.cjs');

const router = express.Router();

function genOrderId() {
  return 'HK' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString().slice(-4);
}

function orderToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    passenger: row.passenger_id ? {
      id: row.passenger_id,
      name: row.passenger_name,
      rating: row.passenger_rating,
    } : undefined,
    driver: row.driver_id ? {
      id: row.driver_id,
      name: row.driver_name,
      plate: row.driver_plate,
      phone: row.driver_phone,
      carModel: row.driver_car_model,
      rating: row.driver_rating,
      currentLat: row.driver_lat,
      currentLng: row.driver_lng,
      isVvip: !!row.driver_is_vvip,
      seatCapacity: row.driver_seat_capacity ?? 4,
    } : undefined,
    pickup: {
      name: row.pickup_name,
      lat: row.pickup_lat,
      lng: row.pickup_lng,
    },
    destination: {
      name: row.destination_name,
      lat: row.destination_lat,
      lng: row.destination_lng,
    },
    carType: row.car_type,
    carModel: row.car_model || undefined,
    passengerNotes: row.passenger_notes ? JSON.parse(row.passenger_notes) : undefined,
    hasDiscount: !!row.has_discount,
    tipAmount: row.tip_amount || 0,
    estimatedFare: row.estimated_fare,
    actualFare: row.actual_fare,
    paymentMethod: row.payment_method,
    distanceKm: row.distance_km,
    etaMinutes: row.eta_minutes,
    passengerLat: row.passenger_lat,
    passengerLng: row.passenger_lng,
    taxiType: row.taxi_type,
    driverRating: row.driver_rating,
    passengerRating: row.passenger_rating,
    scheduledAt: row.scheduled_at || undefined,     // 預約叫車（毫秒時間戳）
    isScheduled: !!row.is_scheduled,                // 係咪預約單
    // 司機出貨單（v3）
    createdByDriver: !!row.created_by_driver,
    driverPostedFrom: row.driver_posted_from,
    passengerPhone: row.passenger_phone,
    // v2.0.81：出貨單嘅出單司機電話（接單司機接單後聯絡用；大廳唔會返回）
    ownerDriverPhone: row.owner_driver_phone || undefined,
    teishoku: !!row.teishoku,
    teishokuPrice: row.teishoku_price,
    isDirect: row.is_direct || 'standard',
    // v2.0.78/79：皇牌單10秒鎖定
    royalLock: row.royal_lock ?? 0,
    royalLockExpireAt: row.royal_lock_expire_at || undefined,
    // VVIP 分級派單
    dispatchPhase: row.dispatch_phase ?? 0,
    dispatchPhaseStartedAt: row.dispatch_phase_started_at,
    dispatchUnlockedAt: row.dispatch_unlocked_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    pickedUpAt: row.picked_up_at,
    completedAt: row.completed_at,
    paidAt: row.paid_at,
    finishedAt: row.finished_at,
  };
}

function getOrderById(id) {
  const row = db.prepare(`
    SELECT o.*,
           p.name as passenger_name, p.rating as passenger_rating,
           d.name as driver_name, d.plate as driver_plate,
           d.phone as driver_phone, d.car_model as driver_car_model,
           d.rating as driver_rating,
           d.is_vvip as driver_is_vvip,
           d.seat_capacity as driver_seat_capacity,
           d.current_lat as driver_lat, d.current_lng as driver_lng
    FROM orders o
    LEFT JOIN passengers p ON o.passenger_id = p.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.id = ?
  `).get(id);
  return orderToJson(row);
}

// ========== 乘客叫車 ==========
router.post('/passenger/request', rateLimit({ limit: 12, windowMs: 60 * 1000 }), authPassenger, (req, res) => {
  const { 
    pickup, destination, carType, hasDiscount, tipAmount, estimatedFare, distanceKm, etaMinutes, taxiType,
    pickupName, pickupLat, pickupLng, destinationName, destinationLat, destinationLng,
    discount, tip, carModel, passengerNotes,
    scheduledAt
  } = req.body;

  // Support both flat and nested formats
  const pickupObj = pickup || { name: pickupName, lat: pickupLat, lng: pickupLng };
  const destObj = destination || { name: destinationName, lat: destinationLat, lng: destinationLng };
  const hasDiscountVal = hasDiscount !== undefined ? hasDiscount : (discount === true);
  const tipVal = tipAmount !== undefined ? tipAmount : (tip || 0);

  if (!pickupObj || !destObj || !estimatedFare) {
    return res.status(400).json({ error: '參數唔完整' });
  }

  // 檢查乘客有冇進行中訂單（已完成嘅單唔算，可以再出單）
  // v2.1.7：預約單（scheduled）唔再鎖死「進行中」——預約單未到派單時間，
  // 可以同時出多張（例如今晚一張、聽朝一張）；真正進行中（searching/accepted/picked_up）先鎖
  const active = db.prepare(`SELECT id FROM orders
    WHERE passenger_id = ? AND status IN ('searching','accepted','picked_up')`).get(req.userId);
  if (active) {
    return res.status(400).json({ error: '你有進行中嘅訂單，請先完成' });
  }

  // v2.1.12：預約單上限——每人最多 5 張未派嘅預約單（防止刷單／霸位）
  if (scheduledAt) {
    const schedCount = db.prepare(
      "SELECT COUNT(*) as c FROM orders WHERE passenger_id = ? AND status = 'scheduled'"
    ).get(req.userId);
    if (schedCount && schedCount.c >= 5) {
      return res.status(400).json({ error: '你已經有 5 張預約單（上限），請完成或取消先再出新預約單' });
    }
  }

  const id = genOrderId();
  const now = Date.now();
  // 預約叫車：scheduledAt（毫秒）→ 預約單狀態；否則即時單
  const schedTs = scheduledAt ? Math.floor(Number(scheduledAt)) : null;
  if (schedTs && schedTs < now + 5 * 60 * 1000) {
    return res.status(400).json({ error: '預約時間太近，請改為即時叫車或揀更遲嘅時間' });
  }
  const orderStatus = schedTs ? 'scheduled' : 'searching';
  const pLat = pickupObj.lat ?? 22.3;
  const pLng = pickupObj.lng ?? 114.17;
  // destination 同 pickup 一樣要 fallback：前端 geocode 失敗（例如自訂地址查唔到座標）
  // 時會冇 lat/lng，直接 INSERT NULL 會 500（NOT NULL constraint），唔可以咁
  const dLat = destObj.lat ?? 22.28;
  const dLng = destObj.lng ?? 114.16;

  db.prepare(`INSERT INTO orders (
    id, status, passenger_id,
    pickup_name, pickup_lat, pickup_lng,
    destination_name, destination_lat, destination_lng,
    car_type, car_model, passenger_notes, has_discount, tip_amount, estimated_fare,
    distance_km, eta_minutes,
    passenger_lat, passenger_lng,
    taxi_type, dispatch_phase, dispatch_phase_started_at, created_at,
    passenger_phone,
    created_by_driver, driver_posted_from,
    scheduled_at, is_scheduled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?)`).run(
    id, orderStatus, req.userId,
    pickupObj.name || '上車點', pLat, pLng,
    destObj.name || '目的地', dLat, dLng,
    carType || '4pax', carModel || null, passengerNotes ? JSON.stringify(passengerNotes) : null,
    hasDiscountVal ? 1 : 0, tipVal || 0, estimatedFare,
    distanceKm || null, etaMinutes || null,
    pLat, pLng,
    taxiType || 'red', now, now,
    req.user.phone || null,
    req.userId,
    schedTs, schedTs ? 1 : 0
  );

  const order = getOrderById(id);

  // v2.1.8：預約搶單——預約單一出即派（照皇牌優先），司機可以提早搶定（hold）
  // v2.1.12：預約單照廣播＋播報＋推播（之前漏咗——淨係即時單有 VVIP/hall/push，
  //          令乘客出嘅預約單司機冇即時通知、冇語音播報）
  if (!schedTs) {
    // 即時單：VVIP 分級派單（普通司機要等 dispatch phase 升級先睇到）
    const vvipDrivers = db.prepare(
      "SELECT id FROM drivers WHERE is_vvip = 1 AND online = 1 AND status = 'approved'"
    ).all();
    vvipDrivers.forEach(d => {
      sseHub.publishToDriver(d.id, 'new-vvip-order', { order });
    });
  } else {
    // 預約單：一出即派（照皇牌優先）——VVIP 司機都即時收到
    const vvipDrivers = db.prepare(
      "SELECT id FROM drivers WHERE is_vvip = 1 AND online = 1 AND status = 'approved'"
    ).all();
    vvipDrivers.forEach(d => {
      sseHub.publishToDriver(d.id, 'new-vvip-order', { order });
    });
  }

  // 預約單同即時單都廣播俾大廳＋推播（Web Push/FCM）——司機有聲有通知
  sseHub.publishToDriverHall('new-order', { order });
  sendNewOrderPush(db, order).catch((err) => console.warn('[push] sendNewOrderPush error:', err.message));

  res.json({ order });
});

// ========== 乘客取消叫車 ==========
router.post('/passenger/cancel', authPassenger, (req, res) => {
  // v2.1.0 fix：支援取消預約單（scheduled）＋可指定 orderId；唔可以再「取消咗第二張單」
  const { orderId } = req.body || {};
  let order;
  if (orderId) {
    order = db.prepare('SELECT * FROM orders WHERE id = ? AND passenger_id = ?').get(orderId, req.userId);
  } else {
    order = db.prepare("SELECT * FROM orders WHERE passenger_id = ? AND status IN ('searching','scheduled') ORDER BY created_at DESC LIMIT 1").get(req.userId);
  }
  if (!order) return res.status(400).json({ error: '冇可取消嘅訂單' });
  // 已接單／行車中唔可以乘客單方面取消（要搵客服／司機）
  if (!['searching', 'scheduled'].includes(order.status)) {
    return res.status(400).json({ error: '呢張單已接單，唔可以直接取消' });
  }

  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);

  sseHub.publishToOrder(order.id, 'order-cancelled', { orderId: order.id });
  sseHub.publishToDriverHall('order-cancelled', { orderId: order.id });

  res.json({ ok: true, orderId: order.id });
});

// ========== 乘客當前訂單 ==========
router.get('/passenger/current', authPassenger, (req, res) => {
  const row = db.prepare(`
    SELECT o.*,
           p.name as passenger_name, p.rating as passenger_rating,
           d.name as driver_name, d.plate as driver_plate,
           d.phone as driver_phone, d.car_model as driver_car_model, d.rating as driver_rating,
           d.is_vvip as driver_is_vvip,
           d.current_lat as driver_lat, d.current_lng as driver_lng
    FROM orders o
    LEFT JOIN passengers p ON o.passenger_id = p.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.passenger_id = ? AND o.status IN ('searching','accepted','picked_up','scheduled')
    ORDER BY o.created_at DESC
    LIMIT 1
  `).get(req.userId);
  res.json({ order: orderToJson(row) || null });
});

// ========== 乘客歷史訂單 ==========
router.get('/passenger/history', authPassenger, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*,
           p.name as passenger_name, p.rating as passenger_rating,
           d.name as driver_name, d.plate as driver_plate,
           d.phone as driver_phone,
           d.car_model as driver_car_model, d.rating as driver_rating,
           d.is_vvip as driver_is_vvip
    FROM orders o
    LEFT JOIN passengers p ON o.passenger_id = p.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.passenger_id = ? AND o.status IN ('completed','paid','finished')
    ORDER BY o.created_at DESC
    LIMIT 20
  `).all(req.userId);
  res.json({ orders: rows.map(orderToJson) });
});

// ========== 乘客評分司機 ==========
router.post('/passenger/rate', authPassenger, (req, res) => {
  const { orderId, rating } = req.body;
  if (!orderId || !rating) return res.status(400).json({ error: '參數唔完整' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND passenger_id = ?').get(orderId, req.userId);
  if (!order) return res.status(404).json({ error: '訂單唔存在' });

  db.prepare('UPDATE orders SET driver_rating = ? WHERE id = ?').run(rating, orderId);

  // 更新司機平均分
  if (order.driver_id) {
    const d = db.prepare('SELECT rating, rating_count FROM drivers WHERE id = ?').get(order.driver_id);
    if (d) {
      const newCount = d.rating_count + 1;
      const newRating = ((d.rating * d.rating_count) + rating) / newCount;
      db.prepare('UPDATE drivers SET rating = ?, rating_count = ? WHERE id = ?').run(
        Math.round(newRating * 10) / 10, newCount, order.driver_id
      );
    }
  }

  // 檢查係咪雙方都評分咗
  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (updated.passenger_rating) {
    db.prepare("UPDATE orders SET status = 'finished', finished_at = ? WHERE id = ?").run(Date.now(), orderId);
  }

  sseHub.publishToOrder(orderId, 'driver-rated', { orderId, rating });

  res.json({ ok: true });
});

// ========== 計算兩點距離（km，簡化球面距離） ==========
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ========== 分級派單：檢查並升級 dispatch_phase ==========
// Phase 0 = VVIP 專屬（首 10 秒）
// Phase 1 = 3 公里內司機（10-30 秒）
// Phase 2 = 5 公里內司機（30-60 秒）
// Phase 3 = 全港開放（60 秒後；範圍 999 = 無限制，跨區都接到）
const DISPATCH_PHASE_DURATIONS = [8000, 15000, 25000, 540000]; // v2.1.7：普通司機更快見到單（皇牌仍然 8 秒內獨享） // 每階段持續時間
const DISPATCH_PHASE_RANGES = [0, 3, 5, 999]; // 每階段可見距離（km），0 = 無限（VVIP 唔計距離），999 = 全港開放

// 司機拒單記錄表：拒咗嘅單唔會再派俾同一司機
db.prepare(`CREATE TABLE IF NOT EXISTS order_rejections (
  order_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (order_id, driver_id)
)`).run();

function refreshDispatchPhases() {
  const now = Date.now();
  const orders = db.prepare("SELECT id, dispatch_phase, dispatch_phase_started_at FROM orders WHERE status = 'searching'").all();
  for (const o of orders) {
    let phase = o.dispatch_phase || 0;
    let phaseStart = o.dispatch_phase_started_at || o.created_at;
    let elapsed = now - phaseStart;

    // 逐級升級
    while (phase < DISPATCH_PHASE_DURATIONS.length - 1 && elapsed >= DISPATCH_PHASE_DURATIONS[phase]) {
      elapsed -= DISPATCH_PHASE_DURATIONS[phase];
      phase += 1;
      phaseStart = phaseStart + DISPATCH_PHASE_DURATIONS[phase - 1];
    }

    if (phase !== (o.dispatch_phase || 0)) {
      db.prepare('UPDATE orders SET dispatch_phase = ?, dispatch_phase_started_at = ? WHERE id = ?').run(
        phase, phaseStart, o.id
      );
      // 推送新階段通知
      sseHub.publishToDriverHall('dispatch-phase-updated', {
        orderId: o.id,
        newPhase: phase,
        rangeKm: DISPATCH_PHASE_RANGES[phase],
      });
    }
  }
}

// 每秒鐘刷新一次派單階段
setInterval(refreshDispatchPhases, 1000);

// ========== 司機出貨（發佈訂單俾其他司機接）==========
// 防重複出單：同一司機 180 秒內唔可以出相同路線單
// （雙擊／語音出單重複觸發／出單後冇聲再講多次——全部擋住）
const lastDriverPost = new Map(); // driverId -> { time, key }
router.post('/driver/post', rateLimit({ limit: 12, windowMs: 60 * 1000 }), authDriver, (req, res) => {
  const {
    pickup, destination, carType, carModel, estimatedFare, taxiType,
    isDirect, tip, dispatchPhase, teishokuPrice, passengerPhone, distanceKm, etaMinutes,
    passengerNotes, scheduledAt,
  } = req.body || {};

  const pickupObj = pickup || {};
  const destObj = destination || {};
  // isDirect 一定要係 string（'standard'/'teishoku'/'discount85'/'discount90'/'95'/'90'）：
  // 舊版 app／第三方 caller 可能傳 boolean true，SQLite 唔可以 bind boolean → 會 500，呢度 normalize 防禦
  const isDirectStr = (typeof isDirect === 'string' && isDirect.trim()) ? isDirect.trim()
    : (isDirect === true ? 'direct' : 'standard');
  // 接受 estimatedFare 為 0（「跳錶」單——不定價，實際按錶收費），但要齊起點/目的地
  if (!pickupObj || !destObj || estimatedFare === undefined || estimatedFare === null || estimatedFare === '') {
    return res.status(400).json({ error: '參數唔完整' });
  }

  // 防重複出單（重複提交／語音連觸發）：同一司機 180 秒內相同路線擋第二張
  // v2.1.7：預約出貨單（scheduledAt）唔計入防重——預約單唔同時派，可以出多張；即時單照舊防重
  const dupKey = `${pickupObj.name || ''}|${destObj.name || ''}|${carType || ''}|${taxiType || ''}`;
  const prevPost = lastDriverPost.get(req.userId);
  if (prevPost && Date.now() - prevPost.time < 180000 && prevPost.key === dupKey) {
    return res.status(429).json({ error: '你啱啱先出過相同路線單，3分鐘內唔可以重複出，請確認上一張單係咪已經出咗' });
  }
  const schedTs = scheduledAt ? Math.floor(Number(scheduledAt)) : null;
  // v2.1.12：預約出貨單上限——每人最多 5 張未派嘅預約單
  if (schedTs) {
    const schedCount = db.prepare(
      "SELECT COUNT(*) as c FROM orders WHERE driver_posted_from = ? AND status = 'scheduled'"
    ).get(req.userId);
    if (schedCount && schedCount.c >= 5) {
      return res.status(400).json({ error: '你已經有 5 張預約出貨單（上限），請刪除或等派完先再出新單' });
    }
  }
  if (!schedTs) {
    lastDriverPost.set(req.userId, { time: Date.now(), key: dupKey });
  }

  const id = genOrderId();
  const now = Date.now();
  const pLat = pickupObj.lat ?? 22.3;
  const pLng = pickupObj.lng ?? 114.17;
  const dLat = destObj.lat ?? 22.28;
  const dLng = destObj.lng ?? 114.16;

  // v2.0.81：出貨單記錄「出單司機電話」，接單司機接單後可以聯絡出貨司機
  let ownerDriverPhone = null;
  try {
    const ownerDriver = db.prepare('SELECT phone FROM drivers WHERE id = ?').get(req.userId);
    ownerDriverPhone = ownerDriver?.phone || null;
  } catch { /* ignore */ }

  // v2.0.78/79：皇牌直單（is_direct='direct'）＝皇牌單，出單後 10 秒皇牌鎖定期，
  // 鎖定期內只限皇牌(VVIP)司機接，10 秒到期自動開放俾普通司機
  const isRoyalDirect = isDirectStr === 'direct';
  const royalLock = isRoyalDirect ? 1 : 0;
  const royalLockExpireAt = isRoyalDirect ? now + 10 * 1000 : null;

  // v2.1.5：出貨預約單——scheduledAt（毫秒）→ scheduled 狀態；否則即時單（schedTs 已喺防重度計咗）
  const orderStatus = schedTs ? 'scheduled' : 'searching';

  // passenger_id 用通用值（出貨單冇真實乘客）
  db.prepare(`INSERT INTO orders (
    id, status, passenger_id,
    pickup_name, pickup_lat, pickup_lng,
    destination_name, destination_lat, destination_lng,
    car_type, car_model, passenger_notes, has_discount, tip_amount, estimated_fare,
    distance_km, eta_minutes,
    passenger_lat, passenger_lng,
    taxi_type, dispatch_phase, dispatch_phase_started_at, created_at,
    created_by_driver, driver_posted_from, passenger_phone, teishoku, teishoku_price, is_direct,
    royal_lock, royal_lock_expire_at, owner_driver_phone,
    scheduled_at, is_scheduled
  ) VALUES (?, ?, 'driver_post', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, orderStatus,
    pickupObj.name || '上車點', pLat, pLng,
    destObj.name || '目的地', dLat, dLng,
    carType || '4pax', carModel || null,
    passengerNotes ? JSON.stringify(passengerNotes) : null,
    (isDirectStr === 'discount85') ? 1 : 0, tip || 0, estimatedFare,
    distanceKm || null, etaMinutes || null,
    pLat, pLng,
    taxiType || 'red', schedTs ? 0 : (dispatchPhase ?? 3), now, now,
    1, req.userId, passengerPhone || null,
    (isDirectStr === 'teishoku') ? 1 : 0, teishokuPrice || null, isDirectStr,
    royalLock, royalLockExpireAt, ownerDriverPhone,
    schedTs, schedTs ? 1 : 0
  );

  const order = getOrderById(id);

  // v2.1.8：預約出貨單一出即派（照皇牌優先）——唔再等「前 15 分鐘」；3 分鐘冇人接自動取消
  // 出貨單都做推播：推俾所有訂閱咗嘅司機（有人出貨，接貨司機收到通知）
  sendNewOrderPush(db, order, { title: '🚧 新貨單！' }).catch((err) =>
    console.warn('[push] 出貨 push error:', err.message)
  );

  // v2.1.8：預約出貨單照皇牌優先——首先推送 VVIP 司機
  if (schedTs) {
    const vvipDrivers = db.prepare(
      "SELECT id FROM drivers WHERE is_vvip = 1 AND online = 1 AND status = 'approved'"
    ).all();
    vvipDrivers.forEach(d => {
      sseHub.publishToDriver(d.id, 'new-vvip-order', { order });
    });
  }

  // v2.0.88：出貨單都 SSE 即刻廣播俾所有在線司機——
  // 之前得乘客叫車單先有即時廣播，司機出貨單要靠 polling 先見到，其他司機冇「新貨單」即時語音播報
  // v2.0.89：排除出單司機自己（自己已有「已出單」語音回饋，唔好連讀「新貨單」）
  sseHub.publishToDriverHall('new-order', { order }, req.userId);

  res.json({ order });
});

// ========== 司機取消自己出貨單 ==========
router.post('/driver/cancel-post/:orderId', authDriver, (req, res) => {
  // v2.1.9：預約出貨單（scheduled）都可以刪除（取消）
  const row = db.prepare("SELECT id, pickup_name, destination_name, car_type, taxi_type, status FROM orders WHERE id = ? AND created_by_driver = 1 AND driver_posted_from = ? AND status IN ('searching','scheduled')")
    .get(req.params.orderId, req.userId);
  if (!row) {
    return res.status(404).json({ error: '搵唔到呢張出貨單，或者唔係你出嘅（已接單嘅單唔可以刪除）' });
  }
  db.prepare("UPDATE orders SET status = 'cancelled', finished_at = ? WHERE id = ?").run(Date.now(), req.params.orderId);
  // 取消成功 → 解除呢條路線嘅 3 分鐘防重鎖，司機可以即刻再出相同路線單（唔會被 429 誤擋）
  try {
    const dupKey = `${row.pickup_name || ''}|${row.destination_name || ''}|${row.car_type || ''}|${row.taxi_type || ''}`;
    const prev = lastDriverPost.get(req.userId);
    if (prev && prev.key === dupKey) {
      lastDriverPost.delete(req.userId);
    }
  } catch { /* ignore */ }
  // SSE 通知：取消咗張單（接貨司機大廳即時移除；乘客/貨主端收「已取消」）
  try {
    const updated = getOrderById(req.params.orderId);
    if (updated) {
      sseHub.publishToOrder(req.params.orderId, 'order-cancelled', { order: updated, reason: 'driver_cancelled' });
      sseHub.publishToDriverHall('order-cancelled', { orderId: req.params.orderId, reason: 'driver_cancelled' });
    }
  } catch { /* ignore */ }
  res.json({ ok: true });
});

// ========== 司機接單大廳列表 ==========
router.get('/driver/hall', authDriver, (req, res) => {
  // 淨係俾 approved 同 online 嘅司機睇
  const driver = db.prepare('SELECT status, online, is_vvip, current_lat, current_lng FROM drivers WHERE id = ?').get(req.userId);
  if (!driver || driver.status !== 'approved') {
    return res.json({ orders: [] });
  }
  if (!driver.online) {
    return res.json({ orders: [] });
  }

  // 刷新派單階段（保證數據最新）
  refreshDispatchPhases();

  // 24 小時後自動刪除過期單（淨係清 searching 未接嘅單；已接/進行中單唔會刪）
  const expireBefore = Date.now() - 24 * 60 * 60 * 1000;
  db.prepare(`DELETE FROM orders WHERE status = 'searching' AND created_at < ?`).run(expireBefore);

  // v2.0.78/79：皇牌鎖定期自動解鎖——鎖定期已過嘅皇牌單自動開放俾所有司機
  try {
    db.prepare(`UPDATE orders SET royal_lock = 0
      WHERE royal_lock = 1 AND royal_lock_expire_at IS NOT NULL AND royal_lock_expire_at < ?`)
      .run(Date.now());
  } catch { /* ignore */ }

  const driverLat = driver.current_lat || 22.3;
  const driverLng = driver.current_lng || 114.17;
  const isVvip = !!driver.is_vvip;

  const rows = db.prepare(`
    SELECT o.*,
           p.name as passenger_name, p.rating as passenger_rating, p.phone as passenger_phone,
           d.name as driver_name, d.plate as driver_plate,
           d.car_model as driver_car_model, d.rating as driver_rating,
           d.is_vvip as driver_is_vvip
    FROM orders o
    LEFT JOIN passengers p ON o.passenger_id = p.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.status IN ('searching','scheduled') AND o.created_at > ?
    ORDER BY
      CASE WHEN o.is_direct = 'direct' OR o.royal_lock = 1 THEN 0 ELSE 1 END ASC,
      o.created_at DESC
    LIMIT 20
  `).all(expireBefore);

  // 按派單階段 + 司機等級過濾
  const now = Date.now();
  // 一次過攞呢位司機拒絕過嘅單（避免每張單逐次查 DB，大量單時大幅加快）
  const myRejections = new Set(
    db.prepare('SELECT order_id FROM order_rejections WHERE driver_id = ?').all(req.userId).map(r => r.order_id)
  );
  const filtered = rows.filter(row => {
    const phase = row.dispatch_phase || 0;

    // 司機出貨單（即時）：公共單，所有 approved+online 司機都見到（跨區都接到）
    // 但出貨者自己唔會見到自己出嘅單（避免誤接自己張單）
    // v2.1.8：預約出貨單（is_scheduled=1）照行皇牌優先（落返下面 phase/距離過濾）
    if (row.created_by_driver) {
      if (!row.is_scheduled) return row.driver_posted_from !== req.userId;
      if (row.driver_posted_from === req.userId) return false;
    }

    // 拒單記錄：呢位司機拒過嘅單唔會再派俾佢
    if (myRejections.has(row.id)) return false;

    // v2.0.78/79：皇牌鎖定期內（royal_lock=1），普通司機睇唔到，只限皇牌(VVIP)司機
    if (row.royal_lock === 1 && !isVvip) return false;

    // VVIP 司機：所有階段嘅單都睇到
    if (isVvip) return true;

    // 普通司機：phase 0 (VVIP 專屬) 睇唔到
    if (phase === 0) return false;

    // 計算距離，驗證係咪喺該階段範圍內
    const rangeKm = DISPATCH_PHASE_RANGES[phase] || 999;
    const dist = haversineKm(driverLat, driverLng, row.pickup_lat, row.pickup_lng);
    return dist <= rangeKm;
  });

  res.json({
    // v2.0.81 私隱保護：大廳訂單唔帶任何電話（passenger_phone / owner_driver_phone），
    // 司機接單之後先喺訂單詳情見到電話
    orders: filtered.map((row) => {
      const safe = orderToJson(row);
      delete safe.passengerPhone;
      delete safe.ownerDriverPhone;
      return safe;
    }),
    driverIsVvip: isVvip,
    phaseRanges: DISPATCH_PHASE_RANGES,
    phaseDurations: DISPATCH_PHASE_DURATIONS,
    // v2.0.78：司機統計（評分/接單/拒單/拒單率），前端顯示拒單率警告用
    stats: db.getDriverStats(req.userId),
  });
});

// ========== 司機「我出嘅貨」/ 貨主（自己出過嘅單，含接貨司機資料） ==========
router.get('/driver/my-posted', authDriver, (req, res) => {
  const driver = db.prepare('SELECT status FROM drivers WHERE id = ?').get(req.userId);
  if (!driver || driver.status !== 'approved') return res.json({ orders: [] });

  // 30 小時後自動刪除出貨記錄（任何狀態，貨主就唔會再見到）
  const expireBefore = Date.now() - 30 * 60 * 60 * 1000;
  db.prepare(`DELETE FROM orders
    WHERE created_by_driver = 1 AND driver_posted_from = ? AND created_at < ?`)
    .run(req.userId, expireBefore);

  const rows = db.prepare(`
    SELECT o.*,
           d.name as driver_name, d.plate as driver_plate,
           d.phone as driver_phone, d.car_model as driver_car_model,
           d.current_lat as driver_lat, d.current_lng as driver_lng
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.created_by_driver = 1 AND o.driver_posted_from = ?
    ORDER BY o.created_at DESC
  `).all(req.userId);

  const orders = rows.map((row) => {
    const j = orderToJson(row);
    let driverDistanceKm = null;
    if (row.driver_id && row.driver_lat && row.driver_lng && row.pickup_lat && row.pickup_lng) {
      driverDistanceKm = Math.round(haversineKm(row.driver_lat, row.driver_lng, row.pickup_lat, row.pickup_lng) * 10) / 10;
    }
    return {
      ...j,
      driverName: row.driver_name,
      driverPlate: row.driver_plate,
      driverPhone: row.driver_phone,
      driverCarModel: row.driver_car_model,
      driverDistanceKm, // 接貨司機 ↔ 上車點距離（公里）
    };
  });

  res.json({ orders });
});

// ========== 司機接單 ==========
router.post('/driver/accept/:orderId', authDriver, (req, res) => {
  const { orderId } = req.params;
  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.userId);

  if (!driver || driver.status !== 'approved') {
    return res.status(400).json({ error: '你嘅帳號未審批，唔可以接單' });
  }
  if (!driver.online) {
    return res.status(400).json({ error: '請先上線先可以接單' });
  }

  // v2.1.12：已接預約單唔再擋新單——司機 hold 緊預約單都可以接普通即時單
  // （預約單唔會「佔位置」令司機接唔到單；只有進行中嘅即時單先擋）
  const active = db.prepare(`SELECT id FROM orders
    WHERE driver_id = ? AND status IN ('accepted','picked_up') AND is_scheduled = 0`).get(req.userId);
  if (active) {
    return res.status(400).json({ error: '你有進行中嘅訂單' });
  }

  // v2.1.8：預約搶單——預約單（scheduled）都可以接（司機提早 hold；到約定時間先去接）
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND status IN ('searching','scheduled')").get(orderId);
  if (!order) {
    return res.status(400).json({ error: '訂單已經俾人接咗或者取消咗' });
  }

  // 會員級別接單鎖（後端校驗，同前端一致——防繞過前端直接 call API 搶單）
  // 皇牌（vvip）：即刻接得；VIP：10 秒後先接得；普通：30 秒後先接得
  const elapsedSec = Math.floor((Date.now() - (order.created_at || Date.now())) / 1000);
  const vvipActive = !!driver.is_vvip && (!driver.vvip_expires_at || Number(driver.vvip_expires_at) > Date.now());
  const vipActive = !!driver.is_vip && (!driver.vip_expires_at || Number(driver.vip_expires_at) > Date.now());
  const minWaitSec = vvipActive ? 0 : vipActive ? 10 : 30;
  if (minWaitSec > 0 && elapsedSec < minWaitSec) {
    return res.status(403).json({ error: `仲要等 ${minWaitSec - elapsedSec} 秒先可以接單` });
  }

  // v2.0.78/79：皇牌鎖定期單（royal_lock=1）——鎖定期內淨係皇牌(VVIP)司機可以接，
  // 到期自動解鎖（hall 查詢時已解鎖）；普通司機喺鎖定期內直接拒絕
  if (order.royal_lock === 1 && !vvipActive) {
    return res.status(403).json({ error: '呢張皇牌單仲喺皇牌司機鎖定期（10秒），未開放俾普通司機' });
  }

  const now = Date.now();
  // v2.1.2：接單時如果前端有帶真實 GPS，就即刻更新司機位置＋訂單位置（乘客端距離即刻準確）
  const { lat, lng } = req.body || {};
  const hasGps = typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng);
  const driverLat = hasGps ? lat : (driver.current_lat || order.pickup_lat + 0.01);
  const driverLng = hasGps ? lng : (driver.current_lng || order.pickup_lng + 0.01);

  const info = db.prepare(`UPDATE orders SET
    status = 'accepted', driver_id = ?, accepted_at = ?,
    driver_lat = ?, driver_lng = ?
    WHERE id = ? AND status IN ('searching','scheduled')`).run(req.userId, now, driverLat, driverLng, orderId);

  // 並發安全：如果 UPDATE 影響 0 行（單已經俾人搶咗／取消咗），唔好當成接單成功
  if (info.changes === 0) {
    return res.status(400).json({ error: '訂單已經俾人接咗或者取消咗' });
  }

  // v2.1.2：同時更新司機本人嘅最新位置（下次派單距離都準）
  if (hasGps) {
    try {
      db.prepare('UPDATE drivers SET current_lat = ?, current_lng = ? WHERE id = ?').run(lat, lng, req.userId);
    } catch { /* ignore */ }
  }

  const updated = getOrderById(orderId);

  // v2.0.78：接單成功統計 +1（拒單率 = reject / (accept + reject)）
  try {
    db.prepare('UPDATE drivers SET total_accept_count = IFNULL(total_accept_count, 0) + 1 WHERE id = ?').run(req.userId);
  } catch { /* ignore */ }

  sseHub.publishToOrder(orderId, 'order-accepted', { order: updated });
  sseHub.publishToDriverHall('order-taken', { orderId, driverId: req.userId });

  res.json({ order: updated });
});

// ========== 司機取消當前單（放棄單，釋放可再接） ==========
router.post('/driver/cancel-current', authDriver, (req, res) => {
  const order = db.prepare(`SELECT * FROM orders
    WHERE driver_id = ? AND status IN ('accepted','picked_up')
    ORDER BY created_at DESC LIMIT 1`).get(req.userId);
  if (!order) return res.status(400).json({ error: '冇可取消嘅進行中訂單' });

  db.prepare("UPDATE orders SET status = 'cancelled', finished_at = ? WHERE id = ?").run(Date.now(), order.id);
  const updated = getOrderById(order.id);

  sseHub.publishToOrder(order.id, 'order-cancelled', { order: updated });
  sseHub.publishToDriverHall('order-cancelled', { orderId: order.id });

  res.json({ ok: true, order: updated });
});

// ========== v2.1.8：司機放單（預約單專用）——接咗嘅預約單可以放返出嚟，重新派（重出[預約]） ==========
router.post('/driver/release/:orderId', authDriver, (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND driver_id = ? AND status = 'accepted'")
    .get(req.params.orderId, req.userId);
  if (!order) {
    return res.status(404).json({ error: '搵唔到呢張已接嘅單' });
  }
  // 淨係預約單可以放單重派；即時單要用「取消當前單」
  if (!order.is_scheduled) {
    return res.status(400).json({ error: '即時單唔可以放單，請用取消' });
  }
  const now = Date.now();
  db.prepare(`UPDATE orders SET
    status = 'scheduled', driver_id = NULL, accepted_at = NULL,
    driver_lat = NULL, driver_lng = NULL,
    dispatch_phase = 0, dispatch_phase_started_at = ?, created_at = ?,
    royal_lock = 0, royal_lock_expire_at = NULL
    WHERE id = ?`).run(now, now, order.id);
  const updated = getOrderById(order.id);

  // 放單後重新派（照皇牌優先）
  try {
    const vvipDrivers = db.prepare(
      "SELECT id FROM drivers WHERE is_vvip = 1 AND online = 1 AND status = 'approved'"
    ).all();
    vvipDrivers.forEach(d => sseHub.publishToDriver(d.id, 'new-vvip-order', { order: updated }));
    sseHub.publishToDriverHall('new-order', { order: updated });
  } catch { /* ignore */ }

  res.json({ ok: true, order: updated });
});

// ========== 司機拒單 ==========
router.post('/driver/reject/:orderId', authDriver, (req, res) => {
  // 記錄拒單：呢位司機之後唔會再見到呢張單（同一單唔會無限彈返出嚟）
  db.prepare('INSERT OR IGNORE INTO order_rejections (order_id, driver_id, created_at) VALUES (?, ?, ?)')
    .run(req.params.orderId, req.userId, Date.now());

  // v2.0.78：拒單統計 +1（拒單率 = reject / (accept + reject)）
  try {
    db.prepare('UPDATE drivers SET reject_count = IFNULL(reject_count, 0) + 1 WHERE id = ?').run(req.userId);
  } catch { /* ignore */ }

  // 通知該司機端：確認已拒單，可即時收起浮動卡／列表項
  sseHub.publishToDriver(req.userId, 'order-rejected-confirmed', { orderId: req.params.orderId });

  res.json({ ok: true });
});

// ========== 司機當前訂單 ==========
router.get('/driver/current', authDriver, (req, res) => {
  // v2.0.83 保護機制：自動清理超時殘留單（防止登入彈舊單卡死）——
  // accepted 超過 2 小時未接客 / picked_up 超過 6 小時未完成 → 自動取消，釋放司機
  const now = Date.now();
  try {
    db.prepare(`UPDATE orders SET status = 'cancelled', finished_at = ?
      WHERE driver_id = ? AND status = 'accepted' AND accepted_at IS NOT NULL AND accepted_at < ?`)
      .run(now, req.userId, now - 2 * 60 * 60 * 1000);
    db.prepare(`UPDATE orders SET status = 'cancelled', finished_at = ?
      WHERE driver_id = ? AND status = 'picked_up' AND picked_up_at IS NOT NULL AND picked_up_at < ?`)
      .run(now, req.userId, now - 6 * 60 * 60 * 1000);
  } catch { /* ignore */ }
  const row = db.prepare(`
    SELECT o.*,
           p.name as passenger_name, p.rating as passenger_rating,
           d.name as driver_name, d.plate as driver_plate,
           d.car_model as driver_car_model, d.rating as driver_rating,
           d.is_vvip as driver_is_vvip
    FROM orders o
    LEFT JOIN passengers p ON o.passenger_id = p.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.driver_id = ? AND o.status IN ('accepted','picked_up')
    ORDER BY o.created_at DESC
    LIMIT 1
  `).get(req.userId);
  res.json({ order: orderToJson(row) || null });
});

// ========== 司機訂單記錄（歷史單，可以睇返上一張＋打返俾乘客） ==========
router.get('/driver/history', authDriver, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*,
           p.name as passenger_name, p.rating as passenger_rating,
           d.name as driver_name, d.plate as driver_plate,
           d.car_model as driver_car_model, d.rating as driver_rating,
           d.is_vvip as driver_is_vvip
    FROM orders o
    LEFT JOIN passengers p ON o.passenger_id = p.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.driver_id = ?
    ORDER BY o.created_at DESC
    LIMIT 60
  `).all(req.userId);
  res.json({ orders: rows.map(orderToJson) });
});

// ========== 司機到達上車點 ==========
router.post('/driver/arrive-pickup', authDriver, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE driver_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1').get(req.userId, 'accepted');
  if (!order) return res.status(400).json({ error: '冇進行中嘅接單' });

  db.prepare("UPDATE orders SET status = 'picked_up', picked_up_at = ? WHERE id = ?").run(Date.now(), order.id);
  const updated = getOrderById(order.id);

  sseHub.publishToOrder(order.id, 'order-picked-up', { order: updated });
  res.json({ order: updated });
});

// ========== 司機到達目的地 ==========
router.post('/driver/complete', authDriver, (req, res) => {
  const { actualFare } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE driver_id = ? AND status IN (?, ?, ?) ORDER BY created_at DESC LIMIT 1").get(req.userId, 'picked_up', 'accepted', 'completed');
  if (!order) return res.status(400).json({ error: '冇進行中嘅行程' });

  // 已經完成咗嘅單：冪等返單，唔好再 400，避免司機撳「完成訂單」無限彈
  if (order.status === 'completed') {
    return res.json({ order: getOrderById(order.id) });
  }

  const fare = actualFare ?? order.estimated_fare;
  db.prepare("UPDATE orders SET status = 'completed', actual_fare = ?, completed_at = ? WHERE id = ?").run(fare, Date.now(), order.id);
  const updated = getOrderById(order.id);

  sseHub.publishToOrder(order.id, 'order-completed', { order: updated });
  res.json({ order: updated });
});

// 司機確認已收現金 → 單直接完結（paid/現金），唔再借 driver/complete
router.post('/driver/cash-paid', authDriver, (req, res) => {
  const { orderId, actualFare } = req.body;
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND driver_id = ? AND status IN ('accepted','picked_up','completed')").get(orderId || '', req.userId);
  if (!order) return res.status(400).json({ error: '冇待收現金嘅訂單' });

  const now = Date.now();
  db.prepare("UPDATE orders SET status = 'paid', payment_method = 'cash', paid_at = ?, actual_fare = COALESCE(?, actual_fare) WHERE id = ?").run(
    now, actualFare ?? null, order.id
  );
  const updated = getOrderById(order.id);
  sseHub.publishToOrder(order.id, 'order-paid', { order: updated });
  sseHub.publishToAdmin('order-paid', { order: updated });
  res.json({ order: updated });
});

// ========== 司機收入記錄 ==========
router.get('/driver/earnings', authDriver, (req, res) => {
  const rows = db.prepare(`
    SELECT o.*,
           p.name as passenger_name, p.rating as passenger_rating,
           d.name as driver_name, d.plate as driver_plate,
           d.car_model as driver_car_model, d.rating as driver_rating,
           d.is_vvip as driver_is_vvip
    FROM orders o
    LEFT JOIN passengers p ON o.passenger_id = p.id
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.driver_id = ? AND o.status IN ('paid','finished','completed')
    ORDER BY o.created_at DESC
    LIMIT 30
  `).all(req.userId);
  res.json({ orders: rows.map(orderToJson) });
});

// ========== 司機評分乘客 ==========
router.post('/driver/rate', authDriver, (req, res) => {
  const { orderId, rating } = req.body;
  if (!orderId || !rating) return res.status(400).json({ error: '參數唔完整' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND driver_id = ?').get(orderId, req.userId);
  if (!order) return res.status(404).json({ error: '訂單唔存在' });

  db.prepare('UPDATE orders SET passenger_rating = ? WHERE id = ?').run(rating, orderId);

  // 更新乘客平均分
  if (order.passenger_id) {
    const p = db.prepare('SELECT rating, rating_count FROM passengers WHERE id = ?').get(order.passenger_id);
    if (p) {
      const newCount = p.rating_count + 1;
      const newRating = ((p.rating * p.rating_count) + rating) / newCount;
      db.prepare('UPDATE passengers SET rating = ?, rating_count = ? WHERE id = ?').run(
        Math.round(newRating * 10) / 10, newCount, order.passenger_id
      );
    }
  }

  // v2.0.85 修復「確認完成無限彈卡」：司機撳「確認完成」＝單結算完，即刻轉 finished。
  // 舊邏輯要等「雙方評分齊」先轉 finished——乘客唔評分嘅話單會永遠停留 paid/completed，
  // 前端任何 localStorage fallback / 重新登入都會將佢復活，再彈返「確認完成」畫面無限循環。
  db.prepare("UPDATE orders SET status = 'finished', finished_at = ? WHERE id = ?").run(Date.now(), orderId);

  sseHub.publishToOrder(orderId, 'passenger-rated', { orderId, rating });

  res.json({ ok: true });
});

// ========== 司機上線/落線 ==========
router.post('/driver/online', authDriver, (req, res) => {
  const { online, lat, lng } = req.body;
  const now = Date.now();
  db.prepare('UPDATE drivers SET online = ?, current_lat = ?, current_lng = ?, last_seen = ? WHERE id = ?').run(
    online ? 1 : 0, lat || null, lng || null, online ? now : 0, req.userId
  );
  res.json({ online: !!online, lastSeen: online ? now : 0 });
});

// ========== 司機心跳（維持在線狀態，淨更新 last_seen，唔掂座標） ==========
router.post('/driver/heartbeat', authDriver, (req, res) => {
  const now = Date.now();
  db.prepare('UPDATE drivers SET last_seen = ? WHERE id = ? AND online = 1').run(now, req.userId);
  res.json({ ok: true, lastSeen: now });
});

// ========== 附近在線司機（真實數字，畀乘客叫車頁用） ==========
router.get('/driver/nearby', (req, res) => {
  const { lat, lng, radius = 12 } = req.query;
  const rows = db.prepare(
    "SELECT id, name, plate, current_lat, current_lng FROM drivers WHERE online = 1 AND status = 'approved' AND current_lat IS NOT NULL AND current_lng IS NOT NULL"
  ).all();
  let list = rows;
  if (lat && lng) {
    const pLat = Number(lat);
    const pLng = Number(lng);
    const R = 6371;
    const maxD = Number(radius);
    const distOf = (r) => {
      const dLat = (r.current_lat - pLat) * Math.PI / 180;
      const dLng = (r.current_lng - pLng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(pLat * Math.PI / 180) * Math.cos(r.current_lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    list = rows
      .map((r) => ({ ...r, distance: Math.round(distOf(r) * 10) / 10 }))
      .filter((r) => r.distance <= maxD);
  }
  res.json({ count: list.length, drivers: list });
});

// ========== 更新位置 ==========
router.post('/driver/location', authDriver, (req, res) => {
  const { lat, lng, orderId } = req.body;
  if (lat == null || lng == null) return res.status(400).json({ error: '位置參數唔完整' });

  db.prepare('UPDATE drivers SET current_lat = ?, current_lng = ? WHERE id = ?').run(lat, lng, req.userId);

  if (orderId) {
    db.prepare('UPDATE orders SET driver_lat = ?, driver_lng = ? WHERE id = ? AND driver_id = ?').run(
      lat, lng, orderId, req.userId
    );
    sseHub.publishToOrder(orderId, 'driver-location', { lat, lng, orderId });
  }

  res.json({ ok: true });
});

router.post('/passenger/location', authPassenger, (req, res) => {
  const { lat, lng, orderId } = req.body;
  if (lat == null || lng == null || !orderId) return res.status(400).json({ error: '參數唔完整' });

  db.prepare('UPDATE orders SET passenger_lat = ?, passenger_lng = ? WHERE id = ? AND passenger_id = ?').run(
    lat, lng, orderId, req.userId
  );
  sseHub.publishToOrder(orderId, 'passenger-location', { lat, lng, orderId });

  res.json({ ok: true });
});

// ========== 付款 ==========
router.post('/passenger/pay', authPassenger, (req, res) => {
  const { method, orderId } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND passenger_id = ? AND status = ?').get(orderId || '', req.userId, 'completed');
  if (!order) return res.status(400).json({ error: '冇待付款嘅訂單' });

  const now = Date.now();
  db.prepare("UPDATE orders SET status = 'paid', payment_method = ?, paid_at = ? WHERE id = ?").run(
    method || 'cash', now, order.id
  );
  const updated = getOrderById(order.id);

  sseHub.publishToOrder(order.id, 'order-paid', { order: updated });
  sseHub.publishToAdmin('order-paid', { order: updated });

  res.json({ order: updated });
});

// ========== 香港地區反查（粗略，按最近區中心） ==========
const DISTRICT_CENTERS = [
  { name: '中西區', lat: 22.282, lng: 114.154 },
  { name: '灣仔', lat: 22.277, lng: 114.176 },
  { name: '東區', lat: 22.28, lng: 114.218 },
  { name: '南區', lat: 22.247, lng: 114.16 },
  { name: '油尖旺', lat: 22.319, lng: 114.172 },
  { name: '深水埗', lat: 22.331, lng: 114.162 },
  { name: '九龍城', lat: 22.328, lng: 114.187 },
  { name: '黃大仙', lat: 22.345, lng: 114.199 },
  { name: '觀塘', lat: 22.314, lng: 114.226 },
  { name: '荃灣', lat: 22.371, lng: 114.111 },
  { name: '葵青', lat: 22.357, lng: 114.13 },
  { name: '屯門', lat: 22.391, lng: 113.977 },
  { name: '元朗', lat: 22.443, lng: 114.03 },
  { name: '北區', lat: 22.495, lng: 114.138 },
  { name: '大埔', lat: 22.445, lng: 114.171 },
  { name: '西貢', lat: 22.382, lng: 114.27 },
  { name: '沙田', lat: 22.384, lng: 114.191 },
  { name: '離島', lat: 22.267, lng: 113.947 },
];

function districtOf(lat, lng) {
  let best = '香港';
  let bestDist = Infinity;
  for (const d of DISTRICT_CENTERS) {
    const dist = (lat - d.lat) ** 2 + (lng - d.lng) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = d.name;
    }
  }
  return best;
}

// OSM reverse geocode 攞街名（失敗就淨係顯示地區）
async function reverseGeocodeStreet(lat, lng) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { 'User-Agent': 'dikdou-taxi-app/1.0' }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const road = data?.address?.road;
    const suburb = data?.address?.suburb || data?.address?.town || data?.address?.city_district;
    return [road, suburb].filter(Boolean).join('，') || null;
  } catch {
    return null;
  }
}

// ========== 司機報告位置大水 ==========
router.post('/driver/report-flood', rateLimit({ limit: 5, windowMs: 60 * 1000 }), authDriver, async (req, res) => {
  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.userId);
  if (!driver) return res.status(404).json({ error: '司機唔存在' });

  const now = Date.now();
  const COOLDOWN = 10 * 60 * 1000;
  if (driver.last_flood_report_at && now - driver.last_flood_report_at < COOLDOWN) {
    const remainMs = COOLDOWN - (now - driver.last_flood_report_at);
    const remainMin = Math.ceil(remainMs / 60000);
    return res.status(429).json({ error: `10 分鐘內已報告過，${remainMin} 分鐘後先可以再報`, cooldownRemainMs: remainMs });
  }

  const lat = typeof req.body?.lat === 'number' ? req.body.lat : driver.current_lat;
  const lng = typeof req.body?.lng === 'number' ? req.body.lng : driver.current_lng;

  // 攞唔到位置都照樣報警（緊急功能唔應該因為冇 GPS 而報唔到），地區會顯示「位置未知」
  let district = null;
  let street = null;
  if (typeof lat === 'number' && typeof lng === 'number') {
    district = districtOf(lat, lng);
    street = await reverseGeocodeStreet(lat, lng).catch(() => null);
  }

  const id = 'FL' + Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString().slice(-4);
  db.prepare(
    'INSERT INTO flood_reports (id, driver_id, driver_name, lat, lng, district, street, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, driver.id, driver.name, typeof lat === 'number' ? lat : null, typeof lng === 'number' ? lng : null, district, street, now);
  db.prepare('UPDATE drivers SET last_flood_report_at = ? WHERE id = ?').run(now, driver.id);

  const alert = { id, driverName: driver.name, district, street, lat: typeof lat === 'number' ? lat : null, lng: typeof lng === 'number' ? lng : null, createdAt: now };

  // 推畀所有司機接貨畫面（司機之間互通警報）
  sseHub.publishToDriverHall('flood-alert', alert);
  sseHub.publishToAdmin('flood-alert', alert);

  res.json({ ok: true, alert });
});

// ========== 訂單詳情 ==========
router.get('/:id', (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) return res.status(404).json({ error: '訂單唔存在' });
  res.json({ order });
});

// ========== SSE 訂閱 ==========
router.get('/stream/order/:orderId', authAny, (req, res) => {
  // v2.0.92：加咗 authAny——訂單 stream 含乘客位置/電話等敏感資料，
  // 以前「認 orderId 就夠」，orderId 洩漏（截獲/日誌）就可以偷睇單。而家必須登入先訂閱。
  const { orderId } = req.params;
  sseHub.subscribe(req, res, 'order', orderId);
});

router.get('/stream/driver-hall', authDriver, (req, res) => {
  sseHub.subscribe(req, res, 'driver-hall', null);
});

router.get('/stream/driver', authDriver, (req, res) => {
  sseHub.subscribe(req, res, 'driver', req.userId);
});

// ========== 自動清理「幽靈單」 ==========
// 司機 90 分鐘無心跳（關咗 app／斷線／冇載客）嘅單，自動收尾並釋放司機：
//  - accepted/picked_up → cancelled（未載客，放棄）
//  - paid → completed（已載客，平台唔收費，自動完成）
// 防止幽靈單一直卡住，令司機下次登入自動跳去載客／完成頁（「不停閃退」根因之一）
function cleanupStaleOrders() {
  const staleBefore = Date.now() - 90 * 60 * 1000; // 90 分鐘
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT o.id, o.driver_id, o.status FROM orders o
      JOIN drivers d ON o.driver_id = d.id
      WHERE o.status IN ('accepted','picked_up','paid')
        AND (d.last_seen IS NULL OR d.last_seen < ?)
    `).all(staleBefore);
  } catch { return; }
  if (!rows.length) return;
  const setDone = db.prepare("UPDATE orders SET status = ?, finished_at = ? WHERE id = ?");
  const offline = db.prepare("UPDATE drivers SET online = 0 WHERE id = ?");
  for (const row of rows) {
    try {
      const to = row.status === 'paid' ? 'completed' : 'cancelled';
      setDone.run(to, Date.now(), row.id);
      if (row.driver_id) offline.run(row.driver_id);
      try { sseHub.publishToOrder(row.id, 'order-cancelled', { orderId: row.id }); } catch {}
      try { sseHub.publishToDriverHall('order-cancelled', { orderId: row.id }); } catch {}
      console.log('[cleanup] 幽靈單自動收尾:', row.id, row.status, '→', to, 'driver=', row.driver_id);
    } catch (e) {
      console.warn('[cleanup] 收尾幽靈單失敗', row.id, e.message);
    }
  }
}
setInterval(cleanupStaleOrders, 60 * 1000); // 每分鐘檢查一次
console.log('[cleanup] 幽靈單自動清理已啟動（90 分鐘無心跳自動收尾）');

// ========== v2.1.8：3 分鐘冇人接自動取消 ==========
// 即時單（searching）出咗 3 分鐘冇司機接 → 自動取消＋通知乘客；
// 預約單（scheduled）一出即派（預約搶單），3 分鐘冇人搶 → 都自動取消
// （司機放單重出後 created_at 會 reset，重新計 3 分鐘）
function cleanupUnacceptedOrders() {
  const t3 = Date.now() - 3 * 60 * 1000;
  let rows = [];
  try {
    // v2.1.8：淨係即時單（searching）3 分鐘冇人接先自動取消；
    // 預約單（scheduled）冇時間限制，唔會自動清空
    rows = db.prepare(
      "SELECT id, status FROM orders WHERE status = 'searching' AND created_at < ?"
    ).all(t3);
  } catch { return; }
  if (!rows.length) return;
  const cancel = db.prepare(
    "UPDATE orders SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'searching'"
  );
  for (const r of rows) {
    try {
      const info = cancel.run(Date.now(), r.id);
      if (info.changes === 0) continue;
      const updated = getOrderById(r.id);
      if (updated) {
        try { sseHub.publishToOrder(r.id, 'order-cancelled', { order: updated, reason: 'timeout_3min' }); } catch {}
        try { sseHub.publishToDriverHall('order-cancelled', { orderId: r.id, reason: 'timeout_3min' }); } catch {}
      }
      console.log('[cleanup] 3分鐘冇人接自動取消:', r.id, 'status=', r.status);
    } catch (e) {
      console.warn('[cleanup] 3分鐘取消失敗', r.id, e.message);
    }
  }
}
setInterval(cleanupUnacceptedOrders, 30 * 1000);
console.log('[cleanup] 3分鐘冇人接自動取消已啟動（每 30 秒檢查）');

// ========== 預約叫車排程器（v2.1.9 已停用） ==========
// v2.1.8 起：預約單一出即派（scheduled 狀態可直接搶單），預約面板照皇牌優先派。
// 舊 scheduler「預約時間前 15 分鐘轉 searching＋再推送」會造成：
//  ① 重複派單（一張預約單推兩次）
//  ② 重複推送（司機收到 2-3 個「新貨單！」通知）
// 因此完全停用，預約單保持 scheduled 狀態直到被搶/被取消。
function startOrderScheduler() {
  // v2.1.9：已停用（見上方註釋）
}
console.log('[scheduler] 預約排程已停用（v2.1.8+ 預約一出即派，scheduled 可直接搶）');

// ========== 預約單列表（司機端「預約面板」用）==========
// v2.1.5：顯示排緊嘅預約單（乘客叫車＋貨主出貨都睇到，唔帶電話，私隱安全）
// v2.1.8：預約搶單——一出完即時出現（唔限 24 小時）、冇時間限制（唔會自動取消）；
//         加返「我接咗嘅預約」（可以放單重派）
router.get('/scheduled/upcoming', authDriver, (req, res) => {
  const rows = db.prepare(`
    SELECT o.id, o.status, o.scheduled_at, o.created_at, o.pickup_name, o.destination_name,
           o.estimated_fare, o.car_type, o.taxi_type, o.created_by_driver,
           o.is_direct, o.teishoku, o.tip_amount, o.passenger_notes,
           d.name as driver_name, d.plate as driver_plate
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    WHERE o.status = 'scheduled'
    ORDER BY o.scheduled_at ASC
    LIMIT 20
  `).all();
  // 自己接咗嘅預約單（hold 緊）——預約面板顯示「我嘅預約」＋放單鍵
  // v2.1.12：已接單帶埋乘客電話（接咗先睇到；未接嘅單唔顯示電話，私隱安全）
  const myAccepted = db.prepare(`
    SELECT o.id, o.status, o.scheduled_at, o.created_at, o.pickup_name, o.destination_name,
           o.estimated_fare, o.car_type, o.taxi_type, o.created_by_driver,
           o.is_direct, o.teishoku, o.tip_amount, o.passenger_notes,
           d.name as driver_name, d.plate as driver_plate,
           o.passenger_phone as cargo_phone, p.phone as passenger_phone
    FROM orders o
    LEFT JOIN drivers d ON o.driver_id = d.id
    LEFT JOIN passengers p ON o.passenger_id = p.id
    WHERE o.status = 'accepted' AND o.is_scheduled = 1 AND o.driver_id = ?
    ORDER BY o.scheduled_at ASC
  `).all(req.userId);
  const map = (r, withPhone) => ({
    id: r.id,
    status: r.status,
    scheduledAt: r.scheduled_at,
    createdAt: r.created_at,
    pickup: r.pickup_name,
    destination: r.destination_name,
    estimatedFare: r.estimated_fare,
    carType: r.car_type,
    taxiType: r.taxi_type,
    isCargo: !!r.created_by_driver,
    isDirect: r.is_direct,
    teishoku: !!r.teishoku,
    tipAmount: r.tip_amount || 0,
    notes: r.passenger_notes ? JSON.parse(r.passenger_notes) : undefined,
    driverName: r.driver_name,
    driverPlate: r.driver_plate,
    // 只有「已接」嘅單先帶電話（出貨單用出貨司機電話；乘客單用乘客電話）
    phone: withPhone ? (r.cargo_phone || r.passenger_phone || undefined) : undefined,
  });
  res.json({ orders: rows.map((r) => map(r, false)), myAccepted: myAccepted.map((r) => map(r, true)) });
});

module.exports = router;
module.exports.startOrderScheduler = startOrderScheduler;

// ========== 乘客投訴（存落 server，管理員後台睇到） ==========
router.post('/passenger/complaint', authPassenger, (req, res) => {
  const { orderId, type, description } = req.body;
  if (!orderId) return res.status(400).json({ error: '缺少訂單編號' });
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!row) return res.status(404).json({ error: '訂單唔存在' });
  if (row.passenger_id !== req.userId) return res.status(403).json({ error: '唔可以投訴其他人嘅訂單' });
  const complaint = JSON.stringify({ type: type || '其他', description: description || '', createdAt: Date.now(), status: 'pending' });
  db.prepare('UPDATE orders SET complaint = ?, complaint_reply = NULL WHERE id = ?').run(complaint, orderId);
  try { sseHub.publishToAdmin('complaint-new', { orderId, type: type || '其他' }); } catch { /* ignore */ }
  res.json({ ok: true });
});

// ========== 管理員攞投訴列表 ==========
router.get('/admin/complaints', authAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE complaint IS NOT NULL AND complaint != '' ORDER BY created_at DESC LIMIT 200").all();
  const list = rows.map((o) => {
    let c = null;
    try { c = JSON.parse(o.complaint); } catch { c = null; }
    return {
      id: o.id,
      status: o.status,
      passenger_id: o.passenger_id,
      driver_id: o.driver_id,
      pickup_name: o.pickup_name,
      destination_name: o.destination_name,
      created_at: o.created_at,
      estimated_fare: o.estimated_fare,
      actual_fare: o.actual_fare,
      complaint: c,
      reply: o.complaint_reply || '',
    };
  });
  res.json({ complaints: list });
});

// ========== 管理員處理投訴（標記已處理＋回覆） ==========
router.post('/admin/complaint/resolve', authAdmin, (req, res) => {
  const { orderId, reply } = req.body;
  if (!orderId) return res.status(400).json({ error: '缺少訂單編號' });
  const row = db.prepare('SELECT complaint FROM orders WHERE id = ?').get(orderId);
  if (!row || !row.complaint) return res.status(404).json({ error: '投訴唔存在' });
  let c;
  try { c = JSON.parse(row.complaint); } catch { return res.status(500).json({ error: '投訴資料損毀' }); }
  c.status = 'resolved';
  c.reply = reply || '';
  db.prepare('UPDATE orders SET complaint = ?, complaint_reply = ? WHERE id = ?').run(JSON.stringify(c), reply || '', orderId);
  res.json({ ok: true });
});
