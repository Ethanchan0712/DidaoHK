// v2.1.96：派單可見性共用邏輯
// 大廳列表（orders.cjs hall）、SSE 即時廣播、Web Push、FCM 全部跟同一套規則：
//  - 紅的（市區）單：綠的（新界）司機任何時間都睇唔到、收唔到
//  - 綠的（新界）單：紅的司機優先等綠的；過咗等候時間先開放——王牌 3:00、VIP 3:10、普通 3:30
//  - 指定新界專屬單：紅的司機由頭到尾都睇唔到
// 司機級別有效期過期就降級計時

function driverMatchesOrder(driver, order) {
  if (!driver) return false;
  const driverTaxi = driver.taxi_type || driver.taxiType || 'red';
  const orderTaxi = order.taxiType || order.taxi_type || 'red';
  const designated = !!(order.taxiDesignated || order.taxi_designated);

  if (orderTaxi === 'red' && driverTaxi === 'green') return false;

  if (orderTaxi === 'green' && driverTaxi === 'red') {
    if (designated) return false;
    const vvipActive = !!driver.is_vvip && (!driver.vvip_expires_at || Number(driver.vvip_expires_at) > Date.now());
    const vipActive = !!driver.is_vip && (!driver.vip_expires_at || Number(driver.vip_expires_at) > Date.now());
    const fallbackSec = vvipActive ? 180 : vipActive ? 190 : 210;
    const ageBase = Number(order.createdAt || order.created_at || Date.now());
    if ((Date.now() - ageBase) / 1000 < fallbackSec) return false;
  }
  return true;
}

// 通知／卡片用嘅的士類型標註
function orderTypeTag(order) {
  const orderTaxi = order.taxiType || order.taxi_type || 'red';
  const designated = !!(order.taxiDesignated || order.taxi_designated);
  if (orderTaxi === 'green') return designated ? '🔒指定新界專屬' : '新界的士專屬';
  return '市區專屬';
}

// 備註文字（乘客填嘅 text ＋ 司機出貨自訂 customNote），通知正文用
function orderNoteText(order) {
  const n = order.passengerNotes;
  if (!n) return '';
  const parts = [];
  if (n.customNote) parts.push(String(n.customNote));
  if (n.text) parts.push(String(n.text));
  return parts.length ? ` ｜ 📋${parts.join('，')}` : '';
}

module.exports = { driverMatchesOrder, orderTypeTag, orderNoteText };
