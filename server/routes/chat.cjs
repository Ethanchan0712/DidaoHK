const express = require('express');
const db = require('../db/index.cjs');
const sseHub = require('../sse/hub.cjs');
const { authPassenger, authDriver, authAdmin, authAny } = require('../middleware/auth.cjs');
const { rateLimit } = require('../middleware/rate-limit.cjs');

const router = express.Router();

function genId() {
  return 'msg_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ========== 發送訊息（乘客） ==========
router.post('/passenger/send', rateLimit({ limit: 30, windowMs: 60 * 1000 }), authPassenger, (req, res) => {
  const { orderId, text } = req.body;
  if (!orderId || !text) return res.status(400).json({ error: '參數唔完整' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND passenger_id = ?').get(orderId, req.userId);
  if (!order) return res.status(404).json({ error: '訂單唔存在' });
  if (['cancelled', 'finished'].includes(order.status)) {
    return res.status(400).json({ error: '訂單已完結，唔可以再發訊息' });
  }

  const id = genId();
  const now = Date.now();

  db.prepare(`INSERT INTO chat_messages (id, order_id, sender_role, sender_id, text, timestamp)
              VALUES (?, ?, 'passenger', ?, ?, ?)`).run(id, orderId, req.userId, text, now);

  const message = { id, orderId, from: 'passenger', text, timestamp: now };
  sseHub.publishToOrder(orderId, 'new-message', { message });

  res.json({ message });
});

// ========== 發送訊息（司機） ==========
router.post('/driver/send', rateLimit({ limit: 30, windowMs: 60 * 1000 }), authDriver, (req, res) => {
  const { orderId, text } = req.body;
  if (!orderId || !text) return res.status(400).json({ error: '參數唔完整' });

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND driver_id = ?').get(orderId, req.userId);
  if (!order) return res.status(404).json({ error: '訂單唔存在' });
  if (['cancelled', 'finished'].includes(order.status)) {
    return res.status(400).json({ error: '訂單已完結，唔可以再發訊息' });
  }

  const id = genId();
  const now = Date.now();

  db.prepare(`INSERT INTO chat_messages (id, order_id, sender_role, sender_id, text, timestamp)
              VALUES (?, ?, 'driver', ?, ?, ?)`).run(id, orderId, req.userId, text, now);

  const message = { id, orderId, from: 'driver', text, timestamp: now };
  sseHub.publishToOrder(orderId, 'new-message', { message });

  res.json({ message });
});

// ========== 攞訂單訊息列表 ==========
router.get('/order/:orderId', authAny, (req, res) => {
  // v2.0.92：加 authAny——聊天記錄都係敏感資料，唔可以公開讀
  // v2.1.50：再加「張單相關人」驗證——登入咗但唔係張單嘅人一樣唔可以讀
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
  if (!order) return res.status(404).json({ error: '訂單唔存在' });
  const uid = String(req.userId || '');
  const isPassenger = order.passenger_id && String(order.passenger_id) === uid;
  const isDriver = order.driver_id && String(order.driver_id) === uid;
  const isPoster = order.driver_posted_from && String(order.driver_posted_from) === uid;
  const isAdmin = req.userRole === 'admin' || req.userRole === 'operator';
  if (!isPassenger && !isDriver && !isPoster && !isAdmin) {
    return res.status(403).json({ error: '冇權限睇呢張訂單嘅訊息' });
  }

  const rows = db.prepare(`
    SELECT id, order_id, sender_role as \"from\", text, timestamp
    FROM chat_messages
    WHERE order_id = ?
    ORDER BY timestamp ASC
    LIMIT 200
  `).all(req.params.orderId);

  const messages = rows.map(r => ({
    id: r.id,
    orderId: r.order_id,
    from: r.from,
    text: r.text,
    timestamp: r.timestamp,
  }));

  res.json({ messages });
});

module.exports = router;
