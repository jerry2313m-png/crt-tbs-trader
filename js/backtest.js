// ============================================
// BACKTESTING — Historical strategy simulation
// ============================================

const Backtest = {

  run(sym, tf, bars, balance) {
    const profile = AssetDetector.getProfile(sym);
    const basePrice = DataFeed.price(sym) || (sym === 'XAUUSD' ? 2300 : sym === 'BTCUSD' ? 58000 : 1.08);

    // Generate synthetic history with structure
    const candles = this.generateHistory(profile, basePrice, bars);
    const eqCurves = { crt_tbs: [], crt: [], tbs: [] };
    const results = {
      crt_tbs: this.simulate(candles, profile, balance, 'CRT_TBS'),
      crt: this.simulate(candles, profile, balance, 'CRT'),
      tbs: this.simulate(candles, profile, balance, 'TBS'),
    };
    return { results, candles };
  },

  generateHistory(profile, basePrice, bars) {
    const candles = [];
    let price = basePrice;
    const vol = profile.typicalDailyRangePct / 100;

    // Build a trend with swings
    let trend = Math.random() < 0.5 ? 1 : -1;
    let trendLen = 50 + Math.floor(Math.random() * 100);

    for (let i = 0; i < bars; i++) {
      if (trendLen <= 0) { trend *= -1; trendLen = 50 + Math.floor(Math.random() * 150); }
      trendLen--;

      const bias = trend * vol * price * 0.01;
      const noise = (Math.random() - 0.5) * vol * price * 0.03;
      const jump = Math.random() < 0.01 ? (Math.random() - 0.5) * vol * price * 0.2 : 0;

      const o = price;
      const c = price + bias + noise + jump;
      const h = Math.max(o, c) + Math.random() * Math.abs(c - o) * 0.8;
      const l = Math.min(o, c) - Math.random() * Math.abs(c - o) * 0.8;
      candles.push({ time: Date.now() - (bars - i) * 900000, open: o, high: h, low: l, close: c, volume: 0.5 + Math.random() });
      price = c;
    }
    return candles;
  },

  simulate(candles, profile, balance, mode) {
    const trades = [];
    let equity = balance;
    let peak = balance;
    let maxDD = 0;
    let wins = 0;
    let totalRR = 0;

    // Simple simulation: use swing highs/lows for CRT/TBS
    const lookback = Math.min(profile.crtLookback, 50);

    for (let i = lookback + 10; i < candles.length; i++) {
      const slice = candles.slice(0, i + 1);
      const c = slice[i];

      // Find recent range
      const window = slice.slice(-lookback);
      const hh = Math.max(...window.map(x => x.high));
      const ll = Math.min(...window.map(x => x.low));
      const atr = this.atr(slice, 14);
      if (!atr) continue;

      // Detect breakout with sweep (close beyond range but previous bar was in range)
      const prevC = slice[i - 1];
      const brokeHigh = c.close > hh && prevC.high <= hh + atr * 0.1;
      const brokeLow = c.close < ll && prevC.low >= ll - atr * 0.1;
      // False breakout
      const sweptHigh = window.slice(-3).some(x => x.high > hh) && c.close < hh;
      const sweptLow = window.slice(-3).some(x => x.low < ll) && c.close > ll;

      // Displacement
      const body = Math.abs(c.close - c.open);
      const avgRng = this.avgRange(slice, 20, i);
      const displaced = avgRng > 0 && body > avgRng * 1.3;

      let entry = null, sl = null, tp = null, direction = null;

      if (mode === 'CRT' || mode === 'CRT_TBS') {
        // CRT: sweep + rejection + displacement
        if (sweptLow && c.close > c.open && (displaced || mode === 'CRT_TBS')) {
          // Bullish
          direction = 'BUY';
          entry = c.close;
          sl = ll - atr * 0.3;
          tp = entry + (entry - sl) * profile.minRR;
        } else if (sweptHigh && c.close < c.open && (displaced || mode === 'CRT_TBS')) {
          direction = 'SELL';
          entry = c.close;
          sl = hh + atr * 0.3;
          tp = entry - (sl - entry) * profile.minRR;
        }
      }
      if (!direction && (mode === 'TBS' || mode === 'CRT_TBS')) {
        // TBS: breakout with displacement
        if (brokeHigh && c.close > c.open && displaced) {
          direction = 'BUY'; entry = c.close;
          sl = ll + (hh - ll) * 0.3;
          tp = entry + (entry - sl) * profile.minRR;
        } else if (brokeLow && c.close < c.open && displaced) {
          direction = 'SELL'; entry = c.close;
          sl = hh - (hh - ll) * 0.3;
          tp = entry - (sl - entry) * profile.minRR;
        }
      }

      if (direction && sl && tp) {
        // Simulate outcome by looking forward
        const future = candles.slice(i + 1, i + 100);
        let outcome = 'OPEN';
        let exitPrice = c.close;
        for (const f of future) {
          if (direction === 'BUY') {
            if (f.low <= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
            if (f.high >= tp) { outcome = 'WIN'; exitPrice = tp; break; }
          } else {
            if (f.high >= sl) { outcome = 'LOSS'; exitPrice = sl; break; }
            if (f.low <= tp) { outcome = 'WIN'; exitPrice = tp; break; }
          }
        }
        if (outcome === 'OPEN') {
          exitPrice = future.length ? future[future.length - 1].close : c.close;
          outcome = exitPrice === entry ? 'LOSS' : (exitPrice > entry === (direction === 'BUY') ? 'WIN' : 'LOSS');
        }

        const risk = Math.abs(entry - sl);
        const reward = Math.abs(tp - entry);
        const rr = reward / risk;
        totalRR += rr;

        const riskAmt = equity * 0.01;
        const pointProfit = profile.contractSize * profile.pointValue;
        const pointsRisked = risk / profile.pointValue;
        const lot = Math.min(profile.maxLot, Math.max(profile.minLot, riskAmt / (pointsRisked * pointProfit)));
        const pnlPts = (direction === 'BUY' ? exitPrice - entry : entry - exitPrice) / profile.pointValue;
        const pnl = pnlPts * pointProfit * lot;

        equity += pnl;
        peak = Math.max(peak, equity);
        const dd = (peak - equity) / peak * 100;
        maxDD = Math.max(maxDD, dd);
        if (outcome === 'WIN') wins++;

        trades.push({ entry, exit: exitPrice, direction, pnl, outcome, rr });
        i += 15; // skip ahead to avoid overtrading
      }
    }

    const totalTrades = trades.length;
    const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
    const netProfit = equity - balance;
    const grossWin = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(trades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
    const avgRR = totalTrades ? totalRR / totalTrades : 0;

    return {
      totalTrades, wins, losses: totalTrades - wins,
      winRate, netProfit, profitFactor, maxDD, avgRR, equity,
      trades
    };
  },

  atr(candles, period) {
    if (candles.length < period + 1) return 0;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const c = candles[i], p = candles[i - 1];
      sum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    }
    return sum / period;
  },
  avgRange(candles, period, endIdx) {
    const end = endIdx || candles.length;
    const start = Math.max(0, end - period);
    let sum = 0;
    for (let i = start; i < end; i++) sum += Math.abs(candles[i].high - candles[i].low);
    return sum / (end - start);
  }
};
