/**
 * 星屿乐园 · 前后台 localStorage 同步桥
 * 同标签页：CustomEvent；跨标签页：storage + BroadcastChannel
 */
(function (global) {
  const CHANNEL_NAME = 'stellar-park-sync';
  const ORDERS_RESET_VERSION = '20260806-v2';

  const KEYS = {
    orders: 'stellar_park_orders',
    expressPasses: 'stellar_park_express_passes',
    users: 'stellar_park_users',
    products: 'stellar_park_products',
    ridesStatus: 'stellar_park_rides_status',
    currentUser: 'stellar_park_current_user',
    ordersResetVersion: 'stellar_park_orders_reset_version'
  };

  const EVENT_BY_KEY = {
    [KEYS.orders]: 'orders-updated',
    [KEYS.expressPasses]: 'express-passes-updated',
    [KEYS.users]: 'users-updated',
    [KEYS.products]: 'products-updated',
    [KEYS.ridesStatus]: 'rides-status-updated'
  };

  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = function (event) {
      const key = event.data && event.data.key;
      if (key && EVENT_BY_KEY[key]) {
        global.dispatchEvent(new CustomEvent(EVENT_BY_KEY[key], { detail: { key: key, source: 'broadcast' } }));
      }
    };
  } catch (e) {}

  function notifyDataChange(key) {
    const eventName = EVENT_BY_KEY[key];
    if (eventName) {
      global.dispatchEvent(new CustomEvent(eventName, { detail: { key: key, source: 'local' } }));
    }
    if (channel) {
      channel.postMessage({ key: key, ts: Date.now() });
    }
  }

  function onDataChange(key, handler) {
    const eventName = EVENT_BY_KEY[key];
    if (eventName) {
      global.addEventListener(eventName, handler);
    }
    global.addEventListener('storage', function (event) {
      if (event.key === key) handler({ source: 'storage' });
    });
  }

  function clearOrdersData() {
    localStorage.removeItem(KEYS.orders);
    notifyDataChange(KEYS.orders);
  }

  function clearExpressPassesData() {
    localStorage.removeItem(KEYS.expressPasses);
    notifyDataChange(KEYS.expressPasses);
  }

  function isExpressPass(record) {
    return !!(record && (record.orderType === 'express' || record.ticketId === 'express'));
  }

  function generateVerifyCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return 'EP' + code;
  }

  function buildExpressScanPayload(pass) {
    if (!pass) return '';
    return 'STELLAR|EXPRESS|' + pass.id + '|' + (pass.verifyCode || '');
  }

  function renderQRCode(container, text, size) {
    if (!container || !text) return;
    container.innerHTML = '';
    size = size || 180;
    if (global.QRCode && typeof global.QRCode.toCanvas === 'function') {
      const canvas = document.createElement('canvas');
      canvas.className = 'mx-auto rounded-lg';
      container.appendChild(canvas);
      global.QRCode.toCanvas(canvas, text, {
        width: size,
        margin: 1,
        color: { dark: '#14100A', light: '#FFFFFF' }
      }, function () {});
      return;
    }
    const fallback = document.createElement('div');
    fallback.className = 'mx-auto rounded-lg flex items-center justify-center text-[10px] font-mono break-all p-3';
    fallback.style.cssText = 'width:' + size + 'px;height:' + size + 'px;background:#fff;color:#14100A;border:1px solid #ddd;';
    fallback.textContent = text;
    container.appendChild(fallback);
  }

  function migrateExpressFromOrders() {
    try {
      const orders = JSON.parse(localStorage.getItem(KEYS.orders) || '[]');
      const express = JSON.parse(localStorage.getItem(KEYS.expressPasses) || '[]');
      const expressIds = new Set(express.map(function (item) { return item.id; }));
      const toMigrate = orders.filter(function (o) { return isExpressPass(o); });
      if (!toMigrate.length) return false;
      toMigrate.forEach(function (o) {
        if (expressIds.has(o.id)) return;
        express.unshift(Object.assign({}, o, {
          orderType: 'express',
          ticketId: 'express',
          ticketName: o.ticketName || '快速通行证',
          verifyCode: o.verifyCode || generateVerifyCode()
        }));
      });
      const ticketOrders = orders.filter(function (o) { return !isExpressPass(o); });
      localStorage.setItem(KEYS.orders, JSON.stringify(ticketOrders));
      localStorage.setItem(KEYS.expressPasses, JSON.stringify(express));
      notifyDataChange(KEYS.orders);
      notifyDataChange(KEYS.expressPasses);
      return true;
    } catch (e) {
      return false;
    }
  }

  function applyQueryReset() {
    const params = new URLSearchParams(global.location.search);
    if (params.get('clearOrders') === '1') {
      clearOrdersData();
      localStorage.setItem(KEYS.ordersResetVersion, ORDERS_RESET_VERSION);
      params.delete('clearOrders');
      const query = params.toString();
      const nextUrl = global.location.pathname + (query ? '?' + query : '') + global.location.hash;
      global.history.replaceState({}, '', nextUrl);
      return true;
    }
    return false;
  }

  function applyVersionReset() {
    if (localStorage.getItem(KEYS.ordersResetVersion) !== ORDERS_RESET_VERSION) {
      clearOrdersData();
      localStorage.setItem(KEYS.ordersResetVersion, ORDERS_RESET_VERSION);
      return true;
    }
    return false;
  }

  global.StellarSync = {
    KEYS: KEYS,
    ORDERS_RESET_VERSION: ORDERS_RESET_VERSION,
    notifyDataChange: notifyDataChange,
    onDataChange: onDataChange,
    clearOrdersData: clearOrdersData,
    clearExpressPassesData: clearExpressPassesData,
    isExpressPass: isExpressPass,
    generateVerifyCode: generateVerifyCode,
    buildExpressScanPayload: buildExpressScanPayload,
    renderQRCode: renderQRCode,
    migrateExpressFromOrders: migrateExpressFromOrders,
    applyQueryReset: applyQueryReset,
    applyVersionReset: applyVersionReset,
    formatOrderDateTime: formatOrderDateTime,
    getOrderTimeline: getOrderTimeline,
    renderOrderTimeRowsHtml: renderOrderTimeRowsHtml
  };

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatOrderDateTime(iso, style) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    if (style === 'short') {
      return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function getOrderTimeline(order) {
    if (!order) return [];
    const items = [{ label: '下单时间', at: order.createdAt }];
    if (order.paidAt) items.push({ label: '支付时间', at: order.paidAt });
    if (order.usedAt) items.push({ label: '核销时间', at: order.usedAt });
    if (order.refundedAt) items.push({ label: '退款时间', at: order.refundedAt });
    return items;
  }

  function renderOrderTimeRowsHtml(order, options) {
    options = options || {};
    const rowClass = options.rowClass || 'flex justify-between text-sm';
    const labelClass = options.labelClass || 'text-[var(--stellar-muted-foreground)]';
    const valueClass = options.valueClass || '';
    const style = options.style || 'full';
    return getOrderTimeline(order).map(function(item) {
      return '<div class="' + rowClass + '">' +
        '<span class="' + labelClass + '">' + item.label + '：</span>' +
        '<span class="' + valueClass + '">' + formatOrderDateTime(item.at, style) + '</span>' +
      '</div>';
    }).join('');
  }

  if (!applyQueryReset()) {
    applyVersionReset();
  }
  migrateExpressFromOrders();
})(window);
