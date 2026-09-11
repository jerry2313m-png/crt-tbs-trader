// ============================================
// BROKER ADAPTERS — Pluggable execution endpoints
// ============================================
//
// To connect to a real broker, implement the IBrokerAdapter interface below
// and register it in BrokerAdapters.register(). NEVER commit API keys.
//
// The simulated adapter is used in demo/paper mode. Other adapters require
// a network endpoint (typically a REST/WebSocket bridge you host next to
// your MT4/MT5 terminal or to the broker's API).

const BrokerAdapters = {
  adapters: {},
  active: 'simulated',
  connectionState: 'disconnected',
  credentials: {},

  register(adapter) {
    this.adapters[adapter.id] = adapter;
  },

  setActive(id) {
    if (!this.adapters[id]) throw new Error('Unknown broker adapter: ' + id);
    this.active = id;
  },

  getActive() {
    return this.adapters[this.active];
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

// ===== Adapter interface (all adapters must implement): =====
// connect(creds) -> Promise<bool>
// disconnect()
// getAccountInfo() -> { balance, equity, margin, freeMargin, leverage, currency }
// getSymbols() -> [string]
// getSymbolSpec(sym) -> { point, digits, contractSize, minLot, maxLot, lotStep, spreadBid, spreadAsk, stopsLevel, marginInit }
// getTick(sym) -> { bid, ask, time }
// marketOrder(sym, side, lot, sl, tp, comment) -> Promise<{orderId, openPrice, openedAt}>
// closePosition(orderId) -> Promise<{closePrice, pnl}>
// modifyPosition(orderId, sl, tp) -> Promise<bool>
// getOpenPositions() -> [ {orderId, symbol, side, lot, openPrice, sl, tp, pnl} ]

// ===== Simulated adapter =====
BrokerAdapters.register({
  id: 'simulated',
  name: 'Simulated / Paper Trading',
  isLive: false,

  connect() { return Promise.resolve(true); },
  disconnect() {},

  getAccountInfo() {
    return {
      balance: RiskManager.state.balance,
      equity: RiskManager.state.equity,
      margin: RiskManager.usedMargin(),
      freeMargin: RiskManager.state.equity - RiskManager.usedMargin(),
      leverage: RiskManager.state.smallAccount ? 100 : 500,
      currency: 'USD'
    };
  },

  getSymbolSpec(rawSym) {
    const p = AssetDetector.getProfile(rawSym);
    const s = DataFeed.get(rawSym);
    return {
      point: p.pointValue,
      digits: p.decimals,
      contractSize: p.contractSize,
      minLot: p.minLot,
      maxLot: p.maxLot,
      lotStep: p.lotStep,
      spreadBid: s?.spread / 2 || 0,
      spreadAsk: s?.spread / 2 || 0,
      stopsLevel: 5,  // minimum stop distance in points
      marginInit: 0.02, // 2% margin
    };
  },

  getTick(sym) {
    const s = DataFeed.get(sym);
    if (!s) return null;
    return { bid: s.bid, ask: s.ask, time: Date.now() };
  },

  marketOrder(sym, side, lot, sl, tp, comment) {
    const s = DataFeed.get(sym);
    const price = side === 'BUY' ? s.ask : s.bid;
    // Simulate small slippage
    const slip = VolatilityEngine.estimateSlippage(DataFeed.getCandles(sym, 'M5'), s.profile);
    const execPrice = side === 'BUY' ? price + slip * Math.random() : price - slip * Math.random();
    const id = 'LIVE-' + Date.now() + Math.floor(Math.random() * 10000);
    return Promise.resolve({ orderId: id, openPrice: execPrice, openedAt: Date.now() });
  },

  closePosition(orderId) {
    // ExecutionEngine already computes price/slippage in manageTrades();
    // this stub exists so the interface is uniform.
    return Promise.resolve({ closePrice: 0, pnl: 0 });
  },

  modifyPosition() { return Promise.resolve(true); },

  getOpenPositions() { return []; }
});

// ===== MetaTrader 4/5 bridge adapter =====
// Expected bridge: a small local HTTP/WebSocket service you run on the same
// machine as MT4/MT5 (e.g. a Python/Node EA that exposes a REST API).
BrokerAdapters.register({
  id: 'mt4',
  name: 'MetaTrader 4 (via bridge)',
  isLive: true,
  requiresEndpoint: true,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'endpoint', label: 'Bridge Endpoint URL', placeholder: 'http://127.0.0.1:8001', type: 'text' },
    { name: 'login', label: 'MT4 Login', placeholder: '12345678', type: 'text' },
    { name: 'password', label: 'Password', type: 'password' },
    { name: 'server', label: 'Server', placeholder: 'Broker-Demo', type: 'text' }
  ],

  async connect(creds) {
    if (!creds.endpoint) return false;
    try {
      // In a real deployment this would POST to the bridge:
      // const r = await fetch(creds.endpoint + '/connect', {method:'POST', body: JSON.stringify(creds)});
      // return r.ok;
      this._endpoint = creds.endpoint;
      return false; // returns false until bridge is actually present
    } catch (e) { return false; }
  },
  disconnect() {},
  getAccountInfo() { return { balance:0, equity:0, margin:0, freeMargin:0, leverage:100, currency:'USD' }; },
  getSymbolSpec() { return null; },
  getTick() { return null; },
  marketOrder() { return Promise.reject(new Error('MT4 bridge not connected')); },
  closePosition() { return Promise.reject(new Error('MT4 bridge not connected')); },
  modifyPosition() { return Promise.reject(new Error('MT4 bridge not connected')); },
  getOpenPositions() { return []; }
});

BrokerAdapters.register({
  id: 'mt5',
  name: 'MetaTrader 5 (via bridge)',
  isLive: true,
  requiresEndpoint: true,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'endpoint', label: 'Bridge Endpoint URL', placeholder: 'http://127.0.0.1:8002', type: 'text' },
    { name: 'login', label: 'MT5 Login', type: 'text' },
    { name: 'password', label: 'Password', type: 'password' },
    { name: 'server', label: 'Server', type: 'text' }
  ],
  async connect(c) { this._endpoint = c.endpoint; return false; },
  disconnect() {},
  getAccountInfo() { return { balance:0, equity:0, margin:0, freeMargin:0, leverage:100, currency:'USD' }; },
  getSymbolSpec() { return null; },
  getTick() { return null; },
  marketOrder() { return Promise.reject(new Error('MT5 bridge not connected')); },
  closePosition() { return Promise.reject(new Error('MT5 bridge not connected')); },
  modifyPosition() { return Promise.reject(new Error('MT5 bridge not connected')); },
  getOpenPositions() { return []; }
});

// ===== cTrader Open API adapter =====
BrokerAdapters.register({
  id: 'ctrader',
  name: 'cTrader (Open API)',
  isLive: true,
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

// ===== Binance adapter (crypto spot/futures) =====
BrokerAdapters.register({
  id: 'binance',
  name: 'Binance (Crypto)',
  isLive: true,
  requiresCredentials: true,
  credentialsFields: [
    { name: 'apiKey', label: 'API Key', type: 'text' },
    { name: 'apiSecret', label: 'API Secret', type: 'password' },
    { name: 'mode', label: 'Environment', type: 'select', options: ['testnet', 'live'] }
  ],
  async connect() { return false; },
  disconnect() {},
  getAccountInfo() { return { balance:0, equity:0, margin:0, freeMargin:0, leverage:10, currency:'USDT' }; },
  getSymbolSpec(rawSym) {
    const n = AssetDetector.normalize(rawSym);
    return { point: 0.01, digits: 2, contractSize: 1, minLot: 0.001, maxLot: 1000, lotStep: 0.001, stopsLevel: 10, marginInit: 0.1 };
  },
  getTick() { return null; },
  marketOrder() { return Promise.reject(new Error('Binance API not connected')); },
  closePosition() { return Promise.reject(new Error('Binance API not connected')); },
  modifyPosition() { return Promise.reject(new Error('Binance API not connected')); },
  getOpenPositions() { return []; }
});
