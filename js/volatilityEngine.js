// ============================================
// VOLATILITY ENGINE — Adaptive ATR, spreads, momentum, volatility regimes
// ============================================

const VolatilityEngine = {

  // ATR (Average True Range)
  atr(candles, period = 14) {
    if (candles.length < period + 1) return 0;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const p = candles[i - 1];
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - p.close),
        Math.abs(c.low - p.close)
      );
      trs.push(tr);
    }
    // Wilder smoothing
    let atr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    const recent = trs.slice(-period);
    atr = recent.reduce((a, b) => a + b, 0) / period;
    return atr;
  },

  // Average candle range
  avgRange(candles, period = 20) {
    if (candles.length < period) return 0;
    const recent = candles.slice(-period);
    return recent.reduce((s, c) => s + Math.abs(c.high - c.low), 0) / period;
  },

  // Volatility regime classification
  classify(candles, profile) {
    const atr = this.atr(candles, 14);
    const price = candles[candles.length - 1]?.close || 0;
    if (!price) return { regime: 'NORMAL', atr, relativeVol: 1, avgRange: 0 };

    const atrPct = (atr / price) * 100;
    const avgRng = this.avgRange(candles, 20);

    let regime = 'NORMAL';
    if (atrPct < profile.lowVolatilityPct) regime = 'LOW';
    else if (atrPct > profile.highVolatilityPct) regime = 'HIGH';
    else if (atrPct > profile.highVolatilityPct * 0.7) regime = 'ELEVATED';

    const relativeVol = atrPct / profile.typicalDailyRangePct;

    return { regime, atr, atrPct, relativeVol, avgRange: avgRng };
  },

  // RSI for momentum
  rsi(candles, period = 14) {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  },

  // Spread quality check
  spreadStatus(spread, profile) {
    const maxSpr = profile.maxSpreadPoints * profile.pointValue;
    const typSpr = profile.typicalSpreadPoints * profile.pointValue;
    if (spread > maxSpr) return 'EXCESSIVE';
    if (spread > typSpr * 1.5) return 'WIDE';
    if (spread < typSpr * 0.8) return 'TIGHT';
    return 'NORMAL';
  },

  // Is trading session active?
  isActiveSession(profile) {
    if (profile.trades247) return true;
    const h = new Date().getUTCHours();
    for (const sName of profile.prioritySessions) {
      const s = profile.sessions[sName];
      if (!s) continue;
      const inSess = s.start > s.end ? (h >= s.start || h < s.end) : (h >= s.start && h < s.end);
      if (inSess) return true;
    }
    return false;
  },

  currentSessionName(profile) {
    if (profile.trades247) return '24/7';
    const h = new Date().getUTCHours();
    const active = [];
    for (const name of ['asia', 'london', 'newyork']) {
      const s = profile.sessions?.[name];
      if (!s) continue;
      const inSess = s.start > s.end ? (h >= s.start || h < s.end) : (h >= s.start && h < s.end);
      if (inSess) active.push(name.charAt(0).toUpperCase() + name.slice(1));
    }
    return active.join(' / ') || 'Off-Hours';
  },

  // Slippage estimation (based on volatility)
  estimateSlippage(candles, profile) {
    const atr = this.atr(candles, 14);
    return atr * 0.05; // ~5% of ATR typical
  },

  // Momentum score (0-10)
  momentumScore(candles) {
    const rsi = this.rsi(candles);
    const last5 = candles.slice(-5);
    const momentum = last5.reduce((s, c) => s + (c.close - c.open), 0);
    const avgRng = this.avgRange(candles, 20);
    if (avgRng === 0) return 5;
    const momStrength = Math.abs(momentum) / (avgRng * 5);
    let score = 5;
    if (rsi > 60 && momentum > 0) score = 7 + Math.min(3, momStrength * 3);
    else if (rsi < 40 && momentum < 0) score = 7 + Math.min(3, momStrength * 3);
    else score = 4;
    return Math.min(10, Math.max(0, score));
  }
};
