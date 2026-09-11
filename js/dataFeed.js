// ============================================
// DATA FEED — Realistic simulated price engine
// ============================================
// Generates OHLCV candles with multi-timeframe structure,
// trends, sweeps, displacement, FVGs, order blocks, etc.

const DataFeed = {
  symbols: {},
  tickInterval: null,
  listeners: [],

  // Default watchlist
  WATCHLIST: [
    { sym: 'XAUUSD', basePrice: 2325.50 },
    { sym: 'EURUSD', basePrice: 1.08450 },
    { sym: 'GBPUSD', basePrice: 1.27150 },
    { sym: 'USDJPY', basePrice: 157.450 },
    { sym: 'BTCUSD', basePrice: 58250.00 },
    { sym: 'ETHUSD', basePrice: 3220.50 },
    { sym: 'US30',   basePrice: 38750.00 },
    { sym: 'NAS100', basePrice: 19420.00 },
  ],

  init() {
    for (const item of this.WATCHLIST) {
      const profile = AssetDetector.getProfile(item.sym);
      this.symbols[item.sym] = {
        profile,
        currentPrice: item.basePrice,
        prevClose: item.basePrice,
        bid: item.basePrice,
        ask: item.basePrice,
        spread: profile.typicalSpreadPoints * profile.pointValue,
        candles: { M1: [], M5: [], M15: [], M30: [], H1: [], H4: [], D1: [] },
        dailyHigh: item.basePrice,
        dailyLow: item.basePrice,
        dailyOpen: item.basePrice,
        prevDayHigh: item.basePrice * 1.003,
        prevDayLow: item.basePrice * 0.997,
        prevDayOpen: item.basePrice * 1.001,
        asianHigh: item.basePrice,
        asianLow: item.basePrice,
        londonHigh: item.basePrice,
        londonLow: item.basePrice,
        nyHigh: item.basePrice,
        nyLow: item.basePrice,
        trend: 'NEUTRAL',
        volatility: 1.0,
        volume: 1,
        priceHistory: [],
        structure: null,
        crt: null,
        setup: null,
      };
      this.seedCandles(item.sym);
    }
    this.startTicker();
  },

  // Generate historical candles
  seedCandles(sym) {
    const s = this.symbols[sym];
    const profile = s.profile;
    let price = s.currentPrice;

    // Generate M1 candles for last 2 days (2880 bars)
    const m1Count = 2880;
    const m1Bars = [];
    let high = price, low = price;
    for (let i = m1Count; i >= 0; i--) {
      const t = Date.now() - i * 60000;
      const vol = profile.typicalDailyRangePct / 100;
      // Random walk with mean-reversion & occasional displacement
      const drift = (Math.random() - 0.5) * vol * price * 0.02;
      const news = Math.random() < 0.005 ? (Math.random() - 0.5) * vol * price * 0.3 : 0;
      const trendBias = 0; // Will be smoothed below
      const o = price;
      price = price + drift + news;
      const range = Math.abs((Math.random() - 0.5) * vol * price * 0.05) + Math.abs(drift);
      const c = price;
      const h = Math.max(o, c) + Math.random() * range * 0.5;
      const l = Math.min(o, c) - Math.random() * range * 0.5;
      high = Math.max(high, h);
      low = Math.min(low, l);
      m1Bars.push({ time: t, open: o, high: h, low: l, close: c, volume: 0.5 + Math.random() });
    }
    s.candles.M1 = m1Bars;
    s.currentPrice = price;
    s.bid = price - s.spread / 2;
    s.ask = price + s.spread / 2;

    // Build higher TFs
    this.buildHigherTimeframes(sym);
    this.updateSessionLevels(sym);
  },

  buildHigherTimeframes(sym) {
    const s = this.symbols[sym];
    const m1 = s.candles.M1;
    s.candles.M5 = this.aggregate(m1, 5);
    s.candles.M15 = this.aggregate(m1, 15);
    s.candles.M30 = this.aggregate(m1, 30);
    s.candles.H1 = this.aggregate(m1, 60);
    s.candles.H4 = this.aggregate(m1, 240);
    s.candles.D1 = this.aggregate(m1, 1440);
  },

  aggregate(m1Bars, minutes) {
    const out = [];
    if (!m1Bars.length) return out;
    for (let i = 0; i < m1Bars.length; i += minutes) {
      const chunk = m1Bars.slice(i, i + minutes);
      if (!chunk.length) continue;
      const o = chunk[0].open;
      const c = chunk[chunk.length - 1].close;
      const h = Math.max(...chunk.map(b => b.high));
      const l = Math.min(...chunk.map(b => b.low));
      const v = chunk.reduce((sum, b) => sum + b.volume, 0);
      out.push({ time: chunk[0].time, open: o, high: h, low: l, close: c, volume: v });
    }
    return out;
  },

  updateSessionLevels(sym) {
    const s = this.symbols[sym];
    const d1 = s.candles.D1;
    if (d1.length >= 2) {
      s.prevDayHigh = d1[d1.length - 2].high;
      s.prevDayLow = d1[d1.length - 2].low;
      s.prevDayOpen = d1[d1.length - 2].open;
    }
    const last24h = s.candles.M1.slice(-1440);
    s.dailyHigh = Math.max(...last24h.map(b => b.high));
    s.dailyLow = Math.min(...last24h.map(b => b.low));
    s.dailyOpen = last24h[0]?.open || s.currentPrice;

    // Session highs/lows (approx UTC)
    const now = new Date();
    const utcHour = now.getUTCHours();
    const m1 = s.candles.M1;

    // Asian (23:00-08:00 UTC)
    const asianBars = this.getSessionBars(m1, 23, 8);
    if (asianBars.length) {
      s.asianHigh = Math.max(...asianBars.map(b => b.high));
      s.asianLow = Math.min(...asianBars.map(b => b.low));
    }
    // London (07:00-16:00)
    const londonBars = this.getSessionBars(m1, 7, 16);
    if (londonBars.length) {
      s.londonHigh = Math.max(...londonBars.map(b => b.high));
      s.londonLow = Math.min(...londonBars.map(b => b.low));
    }
    // NY (12:00-21:00)
    const nyBars = this.getSessionBars(m1, 12, 21);
    if (nyBars.length) {
      s.nyHigh = Math.max(...nyBars.map(b => b.high));
      s.nyLow = Math.min(...nyBars.map(b => b.low));
    }
  },

  getSessionBars(m1, startH, endH) {
    const now = Date.now();
    const out = [];
    for (const bar of m1) {
      const h = new Date(bar.time).getUTCHours();
      const withinWrap = startH > endH ? (h >= startH || h < endH) : (h >= startH && h < endH);
      if (withinWrap && (now - bar.time) < 86400000) out.push(bar);
    }
    return out;
  },

  startTicker() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => this.tick(), 1000);
  },

  tick() {
    const now = Date.now();
    for (const sym in this.symbols) {
      const s = this.symbols[sym];
      const p = s.profile;
      const vol = p.typicalDailyRangePct / 100;
      const tickSize = vol * s.currentPrice * 0.002;

      // Add random walk
      let change = (Math.random() - 0.5) * tickSize;

      // Occasional displacement/sweep events
      if (Math.random() < 0.01) {
        const direction = Math.random() < 0.5 ? -1 : 1;
        change += direction * vol * s.currentPrice * 0.008 * Math.random();
      }

      s.currentPrice = Math.max(s.currentPrice + change, 0.00001);
      // Dynamic spread widening during volatile ticks
      const spreadNoise = (Math.random() - 0.5) * p.pointValue * 2;
      s.spread = Math.max(p.pointValue, p.typicalSpreadPoints * p.pointValue + spreadNoise);
      s.bid = s.currentPrice - s.spread / 2;
      s.ask = s.currentPrice + s.spread / 2;

      // Update last M1 candle
      const m1 = s.candles.M1;
      const lastBar = m1[m1.length - 1];
      if (now - lastBar.time >= 60000) {
        // Close bar, start new
        lastBar.close = s.bid;
        m1.push({ time: now, open: s.bid, high: s.bid, low: s.bid, close: s.bid, volume: 0.5 + Math.random() });
        if (m1.length > 5000) m1.shift();
        this.buildHigherTimeframes(sym);
        this.updateSessionLevels(sym);
      } else {
        lastBar.close = s.bid;
        lastBar.high = Math.max(lastBar.high, s.bid);
        lastBar.low = Math.min(lastBar.low, s.bid);
        lastBar.volume += 0.01;
      }

      s.priceHistory.push(s.currentPrice);
      if (s.priceHistory.length > 500) s.priceHistory.shift();
    }

    this.notify();
  },

  subscribe(fn) { this.listeners.push(fn); },
  notify() { for (const fn of this.listeners) fn(this.symbols); },

  getCandles(sym, tf) { return this.symbols[sym]?.candles[tf] || []; },
  get(sym) { return this.symbols[sym]; },
  price(sym) { return this.symbols[sym]?.currentPrice || 0; },
};
