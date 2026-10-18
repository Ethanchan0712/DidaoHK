// v2.0.92：輕量 in-memory rate limiter（單實例部署適用；Render 單 instance）
// 防止登入暴力破解、出單 flood、租車 spam、chat 濫發
// 用 IP + 路由做 key；窗口滑動計數；超限返 429 + Retry-After

const buckets = new Map(); // key -> { times: number[], limit, windowMs }
// 定期清空過期 bucket，避免記憶體無限增長
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    b.times = b.times.filter((t) => now - t < b.windowMs);
    if (b.times.length === 0) buckets.delete(key);
  }
}, 60 * 1000).unref?.();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    // Render 等 proxy 後面攞最前嘅真實 IP（第一個）
    return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// limit: 窗口內最多幾多次；windowMs: 窗口長度（ms）
function rateLimit({ limit, windowMs }) {
  return (req, res, next) => {
    const ip = clientIp(req);
    // 內部測試／本機健康檢查唔限
    if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
    const key = `${ip}:${req.method}:${req.path}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { times: [], limit, windowMs };
      buckets.set(key, b);
    }
    b.times = b.times.filter((t) => now - t < windowMs);
    if (b.times.length >= limit) {
      const oldest = b.times[0] || now;
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `操作太頻繁，請 ${retryAfter} 秒後再試` });
    }
    b.times.push(now);
    next();
  };
}

module.exports = { rateLimit, clientIp };
