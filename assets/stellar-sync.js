/**
 * 星屿乐园 · 前后台 localStorage 同步桥
 * 同标签页：CustomEvent；跨标签页：storage + BroadcastChannel
 */
(function (global) {
  const CHANNEL_NAME = 'stellar-park-sync';
  const ORDERS_RESET_VERSION = '20260806-v2';

  const KEYS = {
    orders: 'stellar_park_orders',
    users: 'stellar_park_users',
    products: 'stellar_park_products',
    ridesStatus: 'stellar_park_rides_status',
    currentUser: 'stellar_park_current_user',
    ordersResetVersion: 'stellar_park_orders_reset_version'
  };

  const EVENT_BY_KEY = {
    [KEYS.orders]: 'orders-updated',
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
    applyQueryReset: applyQueryReset,
    applyVersionReset: applyVersionReset
  };

  if (!applyQueryReset()) {
    applyVersionReset();
  }
})(window);
