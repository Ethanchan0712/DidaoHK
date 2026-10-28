/* 的道 DikDou PWA Service Worker
 * 更新優先策略（v2）：HTML/導航 network-first → 更新後即刻見到新版，唔使清瀏覽記錄
 * 靜態資源（hashed assets）cache-first → 保持快速載入
 */

const CACHE_NAME = 'dikdou-cache-v2';
const APP_SHELL = ['/'];

// 安裝：快取 App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch(() => {
        // 部分資源可能未就緒，忽略錯誤
      });
    })
  );
  self.skipWaiting();
});

// 啟用：清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 收到推播通知：彈系統通知（即使 app 喺後台／鎖屏）
self.addEventListener('push', (event) => {
  let data = { title: '的道 · 新單', body: '有新單，快啲睇下！', url: '/driver/hall' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) { /* 保留預設 */ }
  const options = {
    body: data.body || '有新單，快啲睇下！',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'dikdou-order',
    renotify: true,
    data: data,
    vibrate: [200, 100, 200],
  };
  event.waitUntil(self.registration.showNotification(data.title || '的道', options));
});

// 撳通知：打開對應頁面（新單 → 司機大廳）
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/driver/hall';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) { client.focus(); return; }
      }
      return clients.openWindow(url);
    })
  );
});

// 攔截請求：Stale-While-Revalidate 策略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只處理 GET 請求
  if (request.method !== 'GET') return;

  // 略過非 http(s) 請求
  if (!request.url.startsWith('http')) return;

  // 略過 API 請求（POST 已過濾，呢度處理跨域 SSE 等）
  if (request.url.includes('/api/') || request.url.includes('/events')) return;

  const reqUrl = new URL(request.url);
  const isNavigate = request.mode === 'navigate';
  const isHtml = reqUrl.pathname === '/' || reqUrl.pathname.endsWith('.html');

  // HTML／導航：network-first——更新後即刻攞最新版（離線先 fallback 快取）
  if (isNavigate || isHtml) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() =>
            cache.match(request).then((cached) => cached || cache.match('/'))
          )
      )
    );
    return;
  }

  // 靜態資源（/assets/ 帶 hash 檔名）：cache-first + 背景更新——保持快
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(request).then((cached) => {
        // 網絡更新快取
        const fetchPromise = fetch(request)
          .then((response) => {
            // 只快取成功回應
            if (response && response.status === 200) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => {
            // 離線時返已快取內容
            return cached || caches.match('/');
          });

        // 有快取就即刻返，同時背景更新
        return cached || fetchPromise;
      });
    })
  );
});
