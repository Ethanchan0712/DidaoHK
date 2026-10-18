// SSE Hub - 跨裝置實時同步
// 每個 order 有自己的 channel，乘客同司機都 subscribe

class SSEHub {
  constructor() {
    // Map<orderId, Set<Response>>
    this.orderChannels = new Map();
    // Map<"driver-hall", Set<Response>>
    this.driverHallClients = new Set();
    // Map<"admin", Set<Response>>
    this.adminClients = new Set();
    // Map<driverId, Set<Response>>
    this.driverChannels = new Map();
  }

  subscribe(req, res, channel, key) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    if (channel === 'order') {
      if (!this.orderChannels.has(key)) {
        this.orderChannels.set(key, new Set());
      }
      this.orderChannels.get(key).add(res);
    } else if (channel === 'driver-hall') {
      // 記低每個 driver-hall 連線屬於邊個司機（用嚟廣播時排除出單司機自己）
      res.__driverId = req.userId || null;
      this.driverHallClients.add(res);
    } else if (channel === 'admin') {
      this.adminClients.add(res);
    } else if (channel === 'driver') {
      if (!this.driverChannels.has(key)) {
        this.driverChannels.set(key, new Set());
      }
      this.driverChannels.get(key).add(res);
    }

    const heartbeat = setInterval(() => {
      res.write(':ping\n\n');
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      if (channel === 'order' && this.orderChannels.has(key)) {
        this.orderChannels.get(key).delete(res);
        if (this.orderChannels.get(key).size === 0) {
          this.orderChannels.delete(key);
        }
      } else if (channel === 'driver-hall') {
        this.driverHallClients.delete(res);
      } else if (channel === 'admin') {
        this.adminClients.delete(res);
      } else if (channel === 'driver' && this.driverChannels.has(key)) {
        this.driverChannels.get(key).delete(res);
        if (this.driverChannels.get(key).size === 0) {
          this.driverChannels.delete(key);
        }
      }
    });
  }

  publishToOrder(orderId, event, data) {
    const clients = this.orderChannels.get(orderId);
    if (!clients || clients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { /* ignore */ }
    }
  }

  publishToDriverHall(event, data, excludeDriverId) {
    if (this.driverHallClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.driverHallClients) {
      // v2.0.89：出單司機自己唔收自己張單嘅 new-order 廣播（避免「已出單」＋「新貨單」連讀兩句）
      if (excludeDriverId && res.__driverId === excludeDriverId) continue;
      try { res.write(payload); } catch { /* ignore */ }
    }
  }

  publishToAdmin(event, data) {
    if (this.adminClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.adminClients) {
      try { res.write(payload); } catch { /* ignore */ }
    }
  }

  publishToDriver(driverId, event, data) {
    const clients = this.driverChannels.get(driverId);
    if (!clients || clients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { /* ignore */ }
    }
  }
}

module.exports = new SSEHub();
