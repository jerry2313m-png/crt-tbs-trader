// ============================================
// MARKET STRUCTURE — BOS, CHOCH, FVG, Liquidity, Order Blocks, Sweeps
// ============================================

const MarketStructure = {

  // Identify swing highs/lows (pivots)
  findSwings(candles, lookback = 3) {
    const highs = [];
    const lows = [];
    for (let i = lookback; i < candles.length - lookback; i++) {
      const c = candles[i];
      let isHigh = true, isLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) isHigh = false;
        if (candles[j].low <= c.low) isLow = false;
      }
      if (isHigh) highs.push({ idx: i, price: c.high, time: c.time });
      if (isLow) lows.push({ idx: i, price: c.low, time: c.time });
    }
    return { highs, lows };
  },

  // Find equal highs / equal lows (double top/bottom, liquidity pools)
  findEqualLevels(candles, tolerance = 0.001) {
    const { highs, lows } = this.findSwings(candles, 3);
    const eqHighs = [];
    const eqLows = [];

    for (let i = 0; i < highs.length; i++) {
      for (let j = i + 1; j < highs.length; j++) {
        const diff = Math.abs(highs[i].price - highs[j].price) / highs[i].price;
        if (diff < tolerance) {
          eqHighs.push({ price: (highs[i].price + highs[j].price) / 2, type: 'EQH', i1: highs[i].idx, i2: highs[j].idx });
        }
      }
    }
    for (let i = 0; i < lows.length; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        const diff = Math.abs(lows[i].price - lows[j].price) / lows[i].price;
        if (diff < tolerance) {
          eqLows.push({ price: (lows[i].price + lows[j].price) / 2, type: 'EQL', i1: lows[i].idx, i2: lows[j].idx });
        }
      }
    }
    return { eqHighs, eqLows };
  },

  // Detect trend based on swing structure
  detectTrend(candles, lookback = 20) {
    if (candles.length < lookback) return 'NEUTRAL';
    const recent = candles.slice(-lookback);
    const closes = recent.map(c => c.close);
    // Higher highs and higher lows = bullish
    let hh = 0, hl = 0, lh = 0, ll = 0;
    for (let i = 2; i < closes.length; i++) {
      if (recent[i].high > recent[i - 1].high && recent[i - 1].high > recent[i - 2].high) hh++;
      if (recent[i].low > recent[i - 1].low && recent[i - 1].low > recent[i - 2].low) hl++;
      if (recent[i].high < recent[i - 1].high && recent[i - 1].high < recent[i - 2].high) ll++;
      if (recent[i].low < recent[i - 1].low && recent[i - 1].low < recent[i - 2].low) lh++;
    }
    const bullScore = hh + hl;
    const bearScore = lh + ll;
    if (bullScore > bearScore * 1.5) return 'BULLISH';
    if (bearScore > bullScore * 1.5) return 'BEARISH';

    // Fallback: EMA20 vs EMA50
    const ema20 = this.ema(closes, 20);
    const ema50 = this.ema(closes, 50);
    if (ema20[ema20.length - 1] > ema50[ema50.length - 1] * 1.001) return 'BULLISH';
    if (ema20[ema20.length - 1] < ema50[ema50.length - 1] * 0.999) return 'BEARISH';
    return 'NEUTRAL';
  },

  ema(data, period) {
    const k = 2 / (period + 1);
    const out = [data[0]];
    for (let i = 1; i < data.length; i++) out.push(data[i] * k + out[i - 1] * (1 - k));
    return out;
  },

  // Detect BOS (Break of Structure) or CHOCH (Change of Character)
  detectStructureShift(candles, lookback = 50) {
    const recent = candles.slice(-lookback);
    if (recent.length < 10) return { type: null, direction: null, level: null };

    const { highs, lows } = this.findSwings(recent, 2);
    if (highs.length < 2 || lows.length < 2) return { type: null, direction: null, level: null };

    const last = recent[recent.length - 1];
    const prevHigh = highs[highs.length - 2]?.price;
    const lastHigh = highs[highs.length - 1]?.price;
    const prevLow = lows[lows.length - 2]?.price;
    const lastLow = lows[lows.length - 1]?.price;

    const trend = this.detectTrend(candles, lookback);

    // Bullish BOS/CHOCH: breaks previous swing high
    if (last.close > prevHigh && prevHigh && lastHigh < prevHigh) {
      return { type: trend === 'BULLISH' ? 'BOS' : 'CHOCH', direction: 'BULLISH', level: prevHigh };
    }
    // Bearish BOS/CHOCH: breaks previous swing low
    if (last.close < prevLow && prevLow && lastLow > prevLow) {
      return { type: trend === 'BEARISH' ? 'BOS' : 'CHOCH', direction: 'BEARISH', level: prevLow };
    }
    return { type: null, direction: null, level: null };
  },

  // Detect Fair Value Gaps (3-candle FVGs)
  findFVG(candles, lookback = 30) {
    const recent = candles.slice(-lookback);
    const gaps = [];
    for (let i = 2; i < recent.length; i++) {
      const c1 = recent[i - 2], c2 = recent[i - 1], c3 = recent[i];
      // Bullish FVG: c1.high < c3.low
      if (c3.low > c1.high) {
        gaps.push({ type: 'BULLISH', top: c3.low, bottom: c1.high, idx: i, time: c3.time });
      }
      // Bearish FVG: c3.high < c1.low
      if (c3.high < c1.low) {
        gaps.push({ type: 'BEARISH', top: c1.low, bottom: c3.high, idx: i, time: c3.time });
      }
    }
    return gaps;
  },

  // Detect Order Blocks (last opposing candle before strong displacement)
  findOrderBlocks(candles, lookback = 30, minDisplacement = 0.003) {
    const recent = candles.slice(-lookback);
    const obs = [];
    for (let i = 2; i < recent.length - 1; i++) {
      const range = Math.abs(recent[i].close - recent[i].open);
      const avgRange = this.avgRange(recent, 20, i);
      if (avgRange === 0) continue;
      // Bullish OB: big bear candle before strong bullish displacement
      if (recent[i].close > recent[i].open && range > avgRange * 1.5) {
        // Previous candle is the OB
        ob: if (i > 0) {
          const ob_candle = recent[i - 1];
          if (ob_candle.close < ob_candle.open) {
            obs.push({ type: 'BULLISH', top: ob_candle.high, bottom: ob_candle.low, idx: i - 1 });
          }
        }
      }
      // Bearish OB: big bull candle before strong bearish displacement
      if (recent[i].close < recent[i].open && range > avgRange * 1.5) {
        if (i > 0) {
          const ob_candle = recent[i - 1];
          if (ob_candle.close > ob_candle.open) {
            obs.push({ type: 'BEARISH', top: ob_candle.high, bottom: ob_candle.low, idx: i - 1 });
          }
        }
      }
    }
    return obs;
  },

  avgRange(candles, period, endIdx) {
    const end = endIdx || candles.length;
    const start = Math.max(0, end - period);
    let sum = 0;
    for (let i = start; i < end; i++) sum += Math.abs(candles[i].high - candles[i].low);
    return sum / (end - start);
  },

  // Detect displacement (strong impulse move)
  detectDisplacement(candles, threshold = 1.5) {
    const n = candles.length;
    if (n < 5) return { bullish: false, bearish: false, strength: 0 };
    const last = candles[n - 1];
    const body = Math.abs(last.close - last.open);
    const avg = this.avgRange(candles, 20);
    const strength = body / avg;
    const bullish = last.close > last.open && strength > threshold;
    const bearish = last.close < last.open && strength > threshold;
    return { bullish, bearish, strength };
  },

  // Detect liquidity sweep (price moves beyond a level then reverses)
  detectSweep(candles, level, tolerance, direction) {
    const n = candles.length;
    if (n < 5) return { swept: false };
    const recent = candles.slice(-10);
    let swept = false;
    let sweepCandle = null;
    let rejected = false;

    for (let i = 0; i < recent.length; i++) {
      const c = recent[i];
      if (direction === 'ABOVE' && c.high > level + tolerance) {
        swept = true;
        sweepCandle = c;
        // Rejection: close back below level
        if (c.close < level) rejected = true;
      }
      if (direction === 'BELOW' && c.low < level - tolerance) {
        swept = true;
        sweepCandle = c;
        if (c.close > level) rejected = true;
      }
    }

    // Check current bar for rejection
    const last = candles[n - 1];
    if (swept && !rejected) {
      if (direction === 'ABOVE' && last.close < level) rejected = true;
      if (direction === 'BELOW' && last.close > level) rejected = true;
    }

    return { swept, rejected, sweepCandle };
  },

  // Premium / Discount zones relative to a range
  premiumDiscount(rangeHigh, rangeLow) {
    const mid = (rangeHigh + rangeLow) / 2;
    const premium = mid + (rangeHigh - mid) * 0.5;  // upper 50%
    const discount = mid - (mid - rangeLow) * 0.5; // lower 50%
    return { mid, premium, discount };
  }
};
