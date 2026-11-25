/**
 * 星屿乐园 · Vectoree 云端登录与订单（经本地 BFF，不把密钥放到浏览器）
 */
(function (global) {
  const TOKEN_KEY = 'stellar_park_access_token';
  const SESSION_KEY = 'stellar_park_session';
  const API = '';

  const cache = {
    orders: [],
    express: [],
    users: [],
    session: null,
    ready: false
  };

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(token) {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }
  function authHeaders() {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return headers;
  }
  async function json(method, path, body) {
    const res = await fetch(API + path, {
      method: method,
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data = null;
    try { data = await res.json(); } catch (e) { data = {}; }
    return { ok: res.ok, status: res.status, data: data };
  }

  function splitOrders(list) {
    const orders = [];
    const express = [];
    (list || []).forEach(function (item) {
      if (item && (item.orderType === 'express' || item.ticketId === 'express')) express.push(item);
      else orders.push(item);
    });
    cache.orders = orders;
    cache.express = express;
    return { orders: orders, express: express };
  }

  function notifyAll() {
    if (!global.StellarSync) return;
    StellarSync.notifyDataChange(StellarSync.KEYS.orders);
    StellarSync.notifyDataChange(StellarSync.KEYS.expressPasses);
    StellarSync.notifyDataChange(StellarSync.KEYS.users);
  }

  async function restoreSession() {
    const token = getToken();
    if (!token) {
      cache.session = null;
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    const result = await json('GET', '/api/app-session');
    if (!result.ok || !result.data.user) {
      setToken('');
      cache.session = null;
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    cache.session = result.data.user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(result.data.user));
    localStorage.setItem('stellar_park_current_user', result.data.user.email);
    return result.data.user;
  }

  async function register(email, password) {
    return json('POST', '/api/app-auth', { action: 'register', email: email, password: password });
  }
  async function login(email, password) {
    return json('POST', '/api/app-auth', { action: 'login', email: email, password: password });
  }
  async function verify(email, otp) {
    const result = await json('POST', '/api/app-auth', { action: 'verify', email: email, otp: otp });
    if (result.ok && result.data.accessToken) {
      setToken(result.data.accessToken);
      await restoreSession();
    }
    return result;
  }
  async function resend(email) {
    return json('POST', '/api/app-auth', { action: 'send-verification', email: email });
  }
  function applySessionToken(data) {
    if (data && data.accessToken) {
      setToken(data.accessToken);
      return restoreSession();
    }
    return Promise.resolve(null);
  }

  async function fetchMyOrders() {
    const result = await json('GET', '/api/park/orders');
    if (!result.ok) throw new Error((result.data && result.data.message) || '加载订单失败');
    splitOrders(result.data.orders || []);
    cache.ready = true;
    notifyAll();
    return cache;
  }

  async function fetchAdminOrders() {
    const result = await json('GET', '/api/park/admin/orders');
    if (!result.ok) throw new Error((result.data && result.data.message) || '加载后台订单失败');
    splitOrders(result.data.orders || []);
    cache.ready = true;
    notifyAll();
    return cache;
  }

  async function fetchAdminUsers() {
    const result = await json('GET', '/api/park/admin/users');
    if (!result.ok) return [];
    cache.users = result.data.users || [];
    if (global.StellarSync) StellarSync.notifyDataChange(StellarSync.KEYS.users);
    return cache.users;
  }

  const writes = new Map();
  function queueWrite(id, task) {
    const prev = writes.get(id) || Promise.resolve();
    const job = prev.catch(function () {}).then(task);
    writes.set(id, job);
    return job;
  }
  async function upsert(order) {
    return queueWrite(order.id, async function () {
      const result = await json('POST', '/api/park/orders', order);
      if (!result.ok) throw new Error((result.data && result.data.message) || '保存订单失败');
      return result.data.order || order;
    });
  }
  async function upsertAdmin(order) {
    return queueWrite(order.id, async function () {
      const result = await json('POST', '/api/park/admin/orders', order);
      if (!result.ok) throw new Error((result.data && result.data.message) || '保存订单失败');
      return result.data.order || order;
    });
  }

  async function clearAll() {
    const result = await json('DELETE', '/api/park/admin/orders');
    if (!result.ok) throw new Error((result.data && result.data.message) || '清空失败');
    cache.orders = [];
    cache.express = [];
    notifyAll();
  }

  function logout() {
    setToken('');
    cache.session = null;
    cache.orders = [];
    cache.express = [];
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem('stellar_park_current_user');
  }

  global.StellarCloud = {
    cache: cache,
    getToken: getToken,
    restoreSession: restoreSession,
    register: register,
    login: login,
    verify: verify,
    resend: resend,
    applySessionToken: applySessionToken,
    fetchMyOrders: fetchMyOrders,
    fetchAdminOrders: fetchAdminOrders,
    fetchAdminUsers: fetchAdminUsers,
    upsert: upsert,
    upsertAdmin: upsertAdmin,
    clearAll: clearAll,
    logout: logout
  };
})(window);
