// Web Push 訂閱管理 API
const express = require('express');
const db = require('../db/index.cjs');
const { authDriver } = require('../middleware/auth.cjs');
const { VAPID, sendNewOrderPush } = require('../lib/push.cjs');

const router = express.Router();

// 公開 VAPID public key（前端訂閱要用）+ 推送功能狀態
router.get('/config', (req, res) => {
  res.json({
    ok: true,
    vapidPublicKey: VAPID.publicKey,
    enabled: !!VAPID.publicKey && !!VAPID.privateKey,
  });
});

// 司機登入後註冊推播訂閱（需 driver token）
router.post('/subscribe', authDriver, (req, res) => {
  try {
    const b = req.body || {};
    const sub = b.subscription || b.sub || {};
    if (!sub.endpoint) {
      return res.status(400).json({ error: '訂閱資料唔完整（缺 endpoint）' });
    }
    const saved = db.savePushSubscription(req.userId, sub);
    if (!saved) return res.status(500).json({ error: '儲存訂閱失敗' });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[push] subscribe error:', e.message);
    res.status(500).json({ error: '訂閱失敗' });
  }
});

// 退訂（通知失效／用戶關閉通知）
router.post('/unsubscribe', authDriver, (req, res) => {
  try {
    const b = req.body || {};
    const endpoint = b.endpoint || '';
    if (endpoint) db.removePushSubscription(endpoint);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '退訂失敗' });
  }
});

// 查我嘅訂閱狀態
router.get('/status', authDriver, (req, res) => {
  const subs = db.getPushByDriver(req.userId);
  const fcm = db.getFcmTokensByDriver(req.userId);
  res.json({ ok: true, subscribed: subs.length > 0, count: subs.length, enabled: !!VAPID.publicKey, fcmTokens: fcm.length });
});

// ===== v2.1.0：App（FCM）推送 token 註冊／退訂 =====
router.post('/fcm-token', authDriver, (req, res) => {
  try {
    const { token, platform } = req.body || {};
    if (!token) return res.status(400).json({ error: '缺少 FCM token' });
    const saved = db.saveFcmToken(req.userId, token, platform === 'ios' ? 'ios' : 'android');
    if (!saved) return res.status(500).json({ error: '儲存失敗' });
    res.json({ ok: true });
  } catch (e) {
    console.warn('[push] fcm-token error:', e.message);
    res.status(500).json({ error: '註冊失敗' });
  }
});

router.post('/fcm-unregister', authDriver, (req, res) => {
  try {
    const { token } = req.body || {};
    if (token) db.removeFcmToken(token);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '退訂失敗' });
  }
});

// 測試推送（管理員用——發一條測試通知俾指定司機）
router.post('/test', authDriver, (req, res) => {
  try {
    const subs = db.getPushByDriver(req.userId);
    if (subs.length === 0) return res.status(400).json({ error: '未訂閱，先允許通知再試' });
    const payload = JSON.stringify({
      title: '🔔 測試通知',
      body: '呢條係推播通知測試——你嘅司機端已經連接成功！',
      data: { test: true },
      url: '/driver/hall',
    });
    const { sendOrderUpdatePush } = require('../lib/push.cjs');
    sendOrderUpdatePush(db, { id: 'test' }, '🔔 測試通知', '呢條係推播通知測試——你嘅司機端已經連接成功！')
      .then((r) => res.json({ ok: true, ...r }))
      .catch((e) => res.status(500).json({ error: '測試失敗:' + e.message }));
  } catch (e) {
    res.status(500).json({ error: '測試失敗' });
  }
});

module.exports = router;
