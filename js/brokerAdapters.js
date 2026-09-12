// ============================================
// BROKER ADAPTERS — Pluggable execution endpoints
// ============================================
//
// For live MT5 trading:
//   1. Install MetaTrader 5 on your PC and log into your real/demo account.
//   2. pip install MetaTrader5 flask flask-cors
//   3. Run: python mt5_bridge.py  (serves the app on http://localhost:8080)
//   4. Open the app and go to Settings → Broker → MetaTrader 5.
//      Enter login / password / server and tap Connect.
//   5. The app will route all orders through your MT5 terminal.
//
// The "simulated" adapter is used in pure demo / paper mode (no broker).

const BrokerAdapters = {
  adapters: {},
  active: 'simulated',
  connectionState: 'disconnected',
  credentials: {},
  bridgeUrl: '',  // set when connected to local MT5 bridge

  register(adapter) { this.adapters[adapter.id] = adapter; },

  setActive(id) {
    if (!this.adapters[id]) throw new Error('Unknown broker adapter: ' + id);
    this.active = id;
  },

  getActive() { return this.adapters[this.active]; },

  setBridgeUrl(url) {
    this.bridgeUrl = url.replace(/\/$/, '');
  },

  async connect(creds) {
    this.credentials = creds;
    const a = this.getActive();
    this.connectionState = 'connecting';
    try {
      const ok = await a.connect(creds);
      this.connectionState = ok ? 'connected' : 'failed';
      return ok;
    } catch (e) {
      console.error(e);
      this.connectionState = 'failed';
      return false;
    }
  },

  disconnect() {
    this.getActive().disconnect?.();
    this.connectionState = 'disconnected';
  },

  isLive() {
    return this.active !== 'simulated' && this.connectionState === 'connected';
  }
};

// Helper for HTTP requests to bridge
async function bridgeRequest(path, method = 'GET', body = null) {
  const url = BrokerAdapters.bridgeUrl + path;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  let data;
  try { data = await r.json(); } catch (e) { throw new Error(`Bridge returned non-JSON (HTTP ${r.status})`); }
  if (!r.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  return data;
}

// ========== SIMULATED adapter ==========
BrokerAdapters.register({
  id: 'simulated',
  name: 'Simulated / Paper Trading',
  isLive: false,

  connect() { return Promise.resolve(true); },
  disconnect() {},

  getAccountInfo() {
    return Promise.resolve({
      balance: RiskManager.state.balance,
      equity: RiskManager.state.equity,
      margin: RiskManager.usedMargin(),
      freeMargin: RiskManager.state.equity - RiskManager.usedMargin(),
      leverage: RiskManager.state.smallAccount ? 100 : 500,
      currency: 'USD'
    });
  },

  getSymbolSpec(rawSym) {
    const p = AssetDetector.getProfile(rawSym);
    const s = DataFeed.get(rawSym);
    return Promise.resolve({
      point: p.pointValue, digits: p.decimals, contractSize: p.contractSize,
      minLot: p.minLot, maxLot: p.maxLot, lotStep: p.lotStep,
      stopsLevel: 5, marginInit: 0.02,
      bid: s?.bid, ask: s?.ask, spread: s?.spread,
    });
  },

  getTick(sym) {
    const s = DataFeed.get(sym);
    return Promise.resolve(s ? { bid: s.bid, ask: s.ask, time: Date.now() } : null);
  },

  marketOrder(sym, side, lot, sl, tp, comment) {
    const s = DataFeed.get(sym);
    const price = side === 'buy' ? s.ask : s.bid;
    const slip = VolatilityEngine.estimateSlippage(DataFeed.getCandles(sym, 'M5'), s.profile);
    const execPrice = side === 'buy' ? price + slip * Math.random() : price - slip * Math.random();
    const id = 'DEMO-' + Date.now() + Math.floor(Math.random() * 10000);
    return Promise.resolve({ orderId: id, openPrice: execPrice, openedAt: Date.now() });
  },

  closePosition() { return Promise.resolve({ closePrice: 0, pnl: 0 }); },
  modifyPosition() { return Promise.resolve(true); },
  getOpenPositions() { return Promise.resolve([]); }
});

// ========== META TRADER 5 (local bridge) ==========
BrokerAdapters.register({
  id: 'mt5',
  name: 'MetaTrader 5 (Local Bridge)',
  isLive: false, // set true only after successful connect & user confirms demo/live
  requiresBridge: true,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'bridgeUrl', label: 'Bridge URL', type: 'text', placeholder: 'http://localhost:8080', default: 'http://localhost:8080' },
    { name: 'login', label: 'MT5 Account Login', type: 'text', placeholder: '12345678' },
    { name: 'password', label: 'Investor / Master Password', type: 'password' },
    { name: 'server', label: 'Broker Server Name', type: 'text', placeholder: 'BrokerName-Demo' },
    { name: 'accountType', label: 'Account Type', type: 'select', options: ['DEMO', 'LIVE'] },
  ],

  async connect(creds) {
    const url = (creds.bridgeUrl || 'http://localhost:8080').replace(/\/$/, '');
    BrokerAdapters.setBridgeUrl(url);
    try {
      // First check bridge health
      const health = await bridgeRequest('/api/health');
      if (!health.ok) throw new Error('Bridge not healthy');
      // Then call connect with credentials
      const result = await bridgeRequest('/api/connect', 'POST', {
        login: creds.login,
        password: creds.password,
        server: creds.server,
      });
      if (!result.ok) throw new Error(result.error);
      this.accountInfo = result.account;
      this.isLive = creds.accountType === 'LIVE';
      this._demoMode = creds.accountType === 'DEMO';
      return true;
    } catch (e) {
      throw new Error('Bridge connection failed: ' + e.message);
    }
  },

  disconnect() {
    try { bridgeRequest('/api/disconnect', 'POST'); } catch (e) {}
    this.isLive = false;
  },

  async getAccountInfo() {
    const r = await bridgeRequest('/api/account');
    const a = r.account;
    return {
      balance: a.balance,
      equity: a.equity,
      margin: a.margin,
      freeMargin: a.margin_free,
      leverage: a.leverage,
      currency: a.currency,
      login: a.login,
      server: a.server,
      name: a.name,
    };
  },

  async getSymbolSpec(rawSym) {
    try {
      const r = await bridgeRequest('/api/symbol/' + encodeURIComponent(rawSym));
      const i = r.info;
      const t = i.tick || {};
      return {
        point: i.point,
        digits: i.digits,
        contractSize: i.trade_contract_size,
        minLot: i.volume_min,
        maxLot: i.volume_max,
        lotStep: i.volume_step,
        stopsLevel: i.stops_level,
        spread: i.spread * i.point,
        bid: t.bid,
        ask: t.ask,
        currencyProfit: i.currency_profit,
      };
    } catch (e) {
      // Fallback to local detector
      const p = AssetDetector.getProfile(rawSym);
      return { point: p.pointValue, digits: p.decimals, contractSize: p.contractSize,
               minLot: p.minLot, maxLot: p.maxLot, lotStep: p.lotStep, stopsLevel: 5 };
    }
  },

  async getTick(sym) {
    try {
      const r = await bridgeRequest('/api/tick/' + encodeURIComponent(sym));
      const t = r.tick;
      return { bid: t.bid, ask: t.ask, time: t.time * 1000 };
    } catch (e) { return null; }
  },

  async marketOrder(sym, side, lot, sl, tp, comment) {
    const r = await bridgeRequest('/api/order', 'POST', {
      symbol: sym, side, lot, sl, tp, comment,
    });
    if (!r.ok) throw new Error(r.error);
    return {
      orderId: r.ticket,
      openPrice: r.open_price,
      openedAt: Date.now(),
      volume: r.volume,
    };
  },

  async closePosition(orderId) {
    const r = await bridgeRequest('/api/close', 'POST', { ticket: parseInt(orderId) });
    return { ok: r.ok, price: r.result?.price || 0 };
  },

  async modifyPosition(orderId, sl, tp) {
    const r = await bridgeRequest('/api/modify', 'POST', { ticket: parseInt(orderId), sl, tp });
    return r.ok === true;
  },

  async getOpenPositions() {
    try {
      const r = await bridgeRequest('/api/positions');
      return (r.positions || []).map(p => ({
        orderId: p.ticket,
        symbol: p.symbol,
        side: p.type === 0 ? 'BUY' : 'SELL',
        lot: p.volume,
        openPrice: p.price_open,
        sl: p.sl,
        tp: p.tp,
        pnl: p.profit,
        comment: p.comment,
        openTime: p.time * 1000,
        magic: p.magic,
      }));
    } catch (e) { return []; }
  }
});

// ========== MT4 stub (same bridge protocol; uses MT4 Python API if you switch) ==========
BrokerAdapters.register({
  id: 'mt4',
  name: 'MetaTrader 4',
  isLive: false,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'note', label: 'Note: MT4 requires a bridge too. See mt4_bridge.py (coming soon). The MT5 bridge above works for both MT5-built and hedge-enabled accounts.', type: 'static' },
  ],
  async connect() { return false; },
  disconnect() {},
  getAccountInfo() { return { balance:0, equity:0, margin:0, freeMargin:0, leverage:100, currency:'USD' }; },
  getSymbolSpec() { return null; },
  getTick() { return null; },
  marketOrder() { return Promise.reject(new Error('MT4 bridge not connected')); },
  closePosition() { return Promise.reject(new Error('MT4 bridge not connected')); },
  modifyPosition() { return Promise.reject(new Error('MT4 bridge not connected')); },
  getOpenPositions() { return []; }
});

// ========== cTrader ==========
BrokerAdapters.register({
  id: 'ctrader',
  name: 'cTrader (Open API)',
  isLive: false,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'clientId', label: 'API Client ID', type: 'text' },
    { name: 'clientSecret', label: 'API Client Secret', type: 'password' },
    { name: 'accessToken', label: 'Access Token', type: 'password' },
    { name: 'accountId', label: 'cTrader Account ID', type: 'text' },
    { name: 'mode', label: 'Environment', type: 'select', options: ['demo', 'live'] }
  ],
  async connect() { return false; },
  disconnect() {},
  getAccountInfo() { return { balance:0, equity:0, margin:0, freeMargin:0, leverage:100, currency:'USD' }; },
  getSymbolSpec() { return null; },
  getTick() { return null; },
  marketOrder() { return Promise.reject(new Error('cTrader API not connected')); },
  closePosition() { return Promise.reject(new Error('cTrader API not connected')); },
  modifyPosition() { return Promise.reject(new Error('cTrader API not connected')); },
  getOpenPositions() { return []; }
});

// ========== Coinbase Advanced Trade ==========
BrokerAdapters.register({
  id: 'coinbase',
  name: 'Coinbase Advanced Trade',
  isLive: false,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'bridgeUrl', label: 'Backend API URL', type: 'text', placeholder: 'https://your-server.com', default: 'http://localhost:8080' },
    { name: 'apiKey', label: 'API Key', type: 'password' },
    { name: 'apiSecret', label: 'API Secret', type: 'password' },
    { name: 'mode', label: 'Environment', type: 'select', options: ['sandbox','live'] }
  ],
  async connect(c) {
    if (!c.apiKey || !c.apiSecret) throw new Error('API key/secret required');
    BrokerAdapters.setBridgeUrl(c.bridgeUrl);
    // Delegate to backend
    const r = await bridgeRequest('/api/connections','POST',{broker:'coinbase',credentials:c});
    this.isLive = c.mode === 'live';
    return r.ok;
  },
  disconnect() { try{bridgeRequest('/api/connections/_/disconnect','POST');}catch(e){} this.isLive=false; },
  getAccountInfo() { return bridgeRequest('/api/account').then(r=>({balance:r.balance||0,equity:r.equity||0,margin:0,freeMargin:r.equity||0,leverage:1,currency:'USD'})); },
  getSymbolSpec() { return Promise.reject(new Error('not yet')); },
  getTick() { return Promise.resolve(null); },
  marketOrder(sym,side,lot,sl,tp,comment) { return bridgeRequest('/api/order','POST',{symbol:sym,side,volume:lot,sl,tp,comment}).then(r=>({orderId:r.ticket,openPrice:r.price||0})); },
  closePosition(id) { return bridgeRequest('/api/close','POST',{ticket:id}); },
  modifyPosition(id,sl,tp) { return bridgeRequest('/api/modify','POST',{ticket:id,sl,tp}); },
  getOpenPositions() { return bridgeRequest('/api/positions').then(r=>r.positions||[]); }
});

// ========== Binance ==========
BrokerAdapters.register({
  id: 'binance',
  name: 'Binance (Crypto)',
  isLive: false,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'apiKey', label: 'API Key', type: 'text' },
    { name: 'apiSecret', label: 'API Secret', type: 'password' },
    { name: 'mode', label: 'Environment', type: 'select', options: ['testnet', 'live'] }
  ],
  async connect() { return false; },
  disconnect() {},
  getAccountInfo() { return { balance:0, equity:0, margin:0, freeMargin:0, leverage:10, currency:'USDT' }; },
  getSymbolSpec() { return { point:0.01, digits:2, contractSize:1, minLot:0.001, maxLot:1000, lotStep:0.001, stopsLevel:10 }; },
  getTick() { return null; },
  marketOrder() { return Promise.reject(new Error('Binance API not connected')); },
  closePosition() { return Promise.reject(new Error('Binance API not connected')); },
  modifyPosition() { return Promise.reject(new Error('Binance API not connected')); },
  getOpenPositions() { return []; }
});
