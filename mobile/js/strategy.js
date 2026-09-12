// ============================================
// STRATEGY ENGINE — CRT + TBS with confidence scoring
// ============================================

const Strategy = {

  currentSignals: {},

  analyze(sym, dataFeed) {
    const s = dataFeed.get(sym);
    if (!s) return null;
    const profile = s.profile;

    // Determine active timeframes based on mode
    const mode = App.state.tradingMode;
    const tfs = this.getTimeframes(mode);

    const htCandles = dataFeed.getCandles(sym, tfs.higher);
    const structCandles = dataFeed.getCandles(sym, tfs.structure);
    const entryCandles = dataFeed.getCandles(sym, tfs.entry);
    const scalpCandles = dataFeed.getCandles(sym, tfs.scalp || 'M1');

    if (!entryCandles.length) return null;

    // === 1. Higher Timeframe Trend ===
    const htTrend = MarketStructure.detectTrend(htCandles, Math.min(30, htCandles.length - 2));
    const structTrend = MarketStructure.detectTrend(structCandles, Math.min(30, structCandles.length - 2));

    // === 2. Volatility ===
    const vol = VolatilityEngine.classify(entryCandles, profile);
    const momentum = VolatilityEngine.momentumScore(entryCandles);
    const spreadStatus = VolatilityEngine.spreadStatus(s.spread, profile);
    const inSession = VolatilityEngine.isActiveSession(profile);

    // === 3. CRT Range ===
    const crtRange = this.identifyCRTRange(s, structCandles);

    // === 4. Liquidity pools ===
    const { eqHighs, eqLows } = MarketStructure.findEqualLevels(structCandles, 0.002);
    const buySideLiq = this.collectLiquidity(structCandles, s, 'BUYSIDE');
    const sellSideLiq = this.collectLiquidity(structCandles, s, 'SELLSIDE');

    // === 5. Sweep detection ===
    const bullSweep = this.detectSweepSide(entryCandles, sellSideLiq, 'BELOW', profile, s);
    const bearSweep = this.detectSweepSide(entryCandles, buySideLiq, 'ABOVE', profile, s);

    // === 6. Structure shift (BOS/CHOCH) ===
    const shift = MarketStructure.detectStructureShift(entryCandles, 30);

    // === 7. Displacement ===
    const displacement = MarketStructure.detectDisplacement(entryCandles,
      profile.requireStrongDisplacement ? 1.8 : 1.5);

    // === 8. FVG & Order Blocks ===
    const fvgs = MarketStructure.findFVG(entryCandles, 25);
    const obs = MarketStructure.findOrderBlocks(entryCandles, 25,
      profile.minDisplacementPct);
    const bullFVG = fvgs.filter(f => f.type === 'BULLISH').slice(-3);
    const bearFVG = fvgs.filter(f => f.type === 'BEARISH').slice(-3);
    const bullOB = obs.filter(o => o.type === 'BULLISH').slice(-2);
    const bearOB = obs.filter(o => o.type === 'BEARISH').slice(-2);

    // === 9. TBS Breakout confidence ===
    const tbsBreakout = this.analyzeBreakout(entryCandles, crtRange, profile, vol, s);

    // === 10. Build bullish & bearish setups ===
    const bullSetup = this.scoreBullish({
      htTrend, structTrend, vol, momentum, spreadStatus, inSession,
      crtRange, sellSideLiq, bullSweep, shift, displacement,
      bullFVG, bullOB, tbsBreakout, profile, s, entryCandles
    });
    const bearSetup = this.scoreBearish({
      htTrend, structTrend, vol, momentum, spreadStatus, inSession,
      crtRange, buySideLiq, bearSweep, shift, displacement,
      bearFVG, bearOB, tbsBreakout, profile, s, entryCandles
    });

    // Choose the stronger setup
    let setup = null;
    if (bullSetup.score > bearSetup.score && bullSetup.score >= profile.minConfidence) {
      setup = { ...bullSetup, direction: 'BUY' };
    } else if (bearSetup.score > bullSetup.score && bearSetup.score >= profile.minConfidence) {
      setup = { ...bearSetup, direction: 'SELL' };
    } else {
      // Return best info even if threshold not met
      const best = bullSetup.score > bearSetup.score ?
        { ...bullSetup, direction: 'BUY' } : { ...bearSetup, direction: 'SELL' };
      setup = { ...best, ready: false };
    }

    // === 11. No-trade filters ===
    const noTrade = this.runNoTradeFilters({
      spreadStatus, vol, inSession, setup, profile, s
    });

    const price = s.currentPrice;
    const result = {
      symbol: sym,
      price,
      time: Date.now(),
      trend: htTrend,
      structTrend,
      crtRange,
      buySideLiq: buySideLiq.slice(0, 3),
      sellSideLiq: sellSideLiq.slice(0, 3),
      bullSweep, bearSweep,
      shift,
      displacement,
      bullFVG: bullFVG.slice(-1)[0],
      bearFVG: bearFVG.slice(-1)[0],
      bullOB: bullOB.slice(-1)[0],
      bearOB: bearOB.slice(-1)[0],
      tbsBreakout,
      volatility: vol,
      momentum,
      spreadStatus,
      inSession,
      setup,
      noTrade,
      timeframes: tfs,
      fvgs, obs,
      eqHighs, eqLows,
    };

    this.currentSignals[sym] = result;
    return result;
  },

  getTimeframes(mode) {
    switch (mode) {
      case 'scalping': return { higher: 'H1', structure: 'M15', entry: 'M5', scalp: 'M1' };
      case 'intraday': return { higher: 'H4', structure: 'H1', entry: 'M15', scalp: 'M5' };
      case 'swing':    return { higher: 'D1', structure: 'H4', entry: 'H1', scalp: 'M15' };
      case 'auto':
      default: {
        const h = new Date().getUTCHours();
        // During London/NY overlap use intraday; otherwise swing
        if (h >= 12 && h <= 16) return { higher: 'H4', structure: 'H1', entry: 'M15', scalp: 'M5' };
        if (h >= 7 && h <= 21) return { higher: 'H4', structure: 'H1', entry: 'M15', scalp: 'M5' };
        return { higher: 'D1', structure: 'H4', entry: 'H1', scalp: 'M15' };
      }
    }
  },

  identifyCRTRange(s, candles) {
    // Use session high/low, daily high/low, or recent range
    const n = candles.length;
    if (n < 20) return { high: s.currentPrice, low: s.currentPrice * 0.998, source: 'current' };

    const recent = candles.slice(-20);
    const hh = Math.max(...recent.map(c => c.high));
    const ll = Math.min(...recent.map(c => c.low));

    // Prioritize session range
    const sources = [];
    if (s.asianHigh && s.asianLow) sources.push({ high: s.asianHigh, low: s.asianLow, source: 'Asian' });
    if (s.londonHigh && s.londonLow) sources.push({ high: s.londonHigh, low: s.londonLow, source: 'London' });
    if (s.nyHigh && s.nyLow) sources.push({ high: s.nyHigh, low: s.nyLow, source: 'NY' });
    sources.push({ high: s.prevDayHigh, low: s.prevDayLow, source: 'Previous Day' });
    sources.push({ high: hh, low: ll, source: 'Recent Range' });

    // Find the tightest most relevant range containing current price
    let best = sources[0];
    for (const src of sources) {
      if (s.currentPrice <= src.high && s.currentPrice >= src.low) {
        const size = src.high - src.low;
        const bestSize = best.high - best.low;
        if (size < bestSize * 2) best = src;
      }
    }
    return best;
  },

  collectLiquidity(candles, s, side) {
    const { highs, lows } = MarketStructure.findSwings(candles, 3);
    const levels = [];
    if (side === 'BUYSIDE') {
      // Above price: swing highs, equal highs, prev day high, session highs
      for (const h of highs) if (h.price > s.currentPrice) levels.push({ price: h.price, source: 'swing_high' });
      if (s.prevDayHigh > s.currentPrice) levels.push({ price: s.prevDayHigh, source: 'prev_day_high' });
      if (s.dailyHigh > s.currentPrice) levels.push({ price: s.dailyHigh, source: 'daily_high' });
      if (s.asianHigh > s.currentPrice) levels.push({ price: s.asianHigh, source: 'asian_high' });
      if (s.londonHigh > s.currentPrice) levels.push({ price: s.londonHigh, source: 'london_high' });
    } else {
      for (const l of lows) if (l.price < s.currentPrice) levels.push({ price: l.price, source: 'swing_low' });
      if (s.prevDayLow < s.currentPrice) levels.push({ price: s.prevDayLow, source: 'prev_day_low' });
      if (s.dailyLow < s.currentPrice) levels.push({ price: s.dailyLow, source: 'daily_low' });
      if (s.asianLow < s.currentPrice) levels.push({ price: s.asianLow, source: 'asian_low' });
      if (s.londonLow < s.currentPrice) levels.push({ price: s.londonLow, source: 'london_low' });
    }
    // Sort by proximity to current price
    levels.sort((a, b) => Math.abs(a.price - s.currentPrice) - Math.abs(b.price - s.currentPrice));
    return levels;
  },

  detectSweepSide(candles, liqLevels, direction, profile, s) {
    if (!liqLevels.length) return { swept: false, rejected: false, level: null };
    const nearest = liqLevels[0];
    const tolerance = VolatilityEngine.atr(candles, 14) * 0.1;
    const sweep = MarketStructure.detectSweep(candles, nearest.price, tolerance, direction);
    return { ...sweep, level: nearest.price, source: nearest.source };
  },

  analyzeBreakout(candles, crtRange, profile, vol, s) {
    const n = candles.length;
    if (n < 10 || !crtRange) return { confidence: 0, direction: null, type: null };

    const last = candles[n - 1];
    const atr = vol.atr || VolatilityEngine.atr(candles);
    const bodySize = Math.abs(last.close - last.open);
    const avgRng = vol.avgRange || MarketStructure.avgRange(candles, 20);
    const candleStrength = avgRng > 0 ? bodySize / avgRng : 1;

    let confidence = 0;
    let direction = null;
    let type = null;

    // Break above range
    if (last.close > crtRange.high) {
      direction = 'BULLISH';
      type = 'RANGE_BREAKOUT';
      confidence += 20;
      if (candleStrength > 1.3) confidence += 15;
      if (candleStrength > 2.0) confidence += 10;
      if (last.close > last.open) confidence += 10;
      if (vol.regime !== 'HIGH') confidence += 10;
    }
    // Break below range
    else if (last.close < crtRange.low) {
      direction = 'BEARISH';
      type = 'RANGE_BREAKOUT';
      confidence += 20;
      if (candleStrength > 1.3) confidence += 15;
      if (candleStrength > 2.0) confidence += 10;
      if (last.close < last.open) confidence += 10;
      if (vol.regime !== 'HIGH') confidence += 10;
    }
    // False breakout check (broke out but closed back inside)
    else {
      const brokeHigh = candles.slice(-5).some(c => c.high > crtRange.high);
      const brokeLow = candles.slice(-5).some(c => c.low < crtRange.low);
      if (brokeHigh && last.close < crtRange.high) {
        direction = 'BEARISH'; type = 'FALSE_BREAKOUT_HIGH'; confidence = 45;
      }
      if (brokeLow && last.close > crtRange.low) {
        direction = 'BULLISH'; type = 'FALSE_BREAKOUT_LOW'; confidence = 45;
      }
    }

    return { confidence: Math.min(100, confidence), direction, type, candleStrength };
  },

  scoreBullish(ctx) {
    const w = ctx.profile.confWeights;
    let score = 0;
    const details = {};

    // HT trend
    if (ctx.htTrend === 'BULLISH') { score += w.htTrend; details.htTrend = w.htTrend; }
    else if (ctx.htTrend === 'NEUTRAL') { score += w.htTrend * 0.5; details.htTrend = w.htTrend * 0.5; }
    else details.htTrend = 0;

    // Liquidity sweep (sell-side)
    if (ctx.bullSweep.swept && ctx.bullSweep.rejected) {
      score += w.liquiditySweep; details.liquiditySweep = w.liquiditySweep;
    } else if (ctx.bullSweep.swept) {
      score += w.liquiditySweep * 0.5; details.liquiditySweep = w.liquiditySweep * 0.5;
    } else details.liquiditySweep = 0;

    // BOS/CHOCH
    if (ctx.shift.type && ctx.shift.direction === 'BULLISH') {
      score += w.bosChoch; details.bosChoch = w.bosChoch;
    } else details.bosChoch = 0;

    // Displacement
    if (ctx.displacement.bullish) {
      let dScore = w.displacement;
      if (ctx.displacement.strength > 2.5) dScore = w.displacement;
      else if (ctx.displacement.strength > 1.8) dScore = w.displacement * 0.7;
      score += dScore; details.displacement = dScore;
    } else details.displacement = 0;

    // FVG / OB
    let fvgScore = 0;
    if (ctx.bullFVG) fvgScore += w.fvg * 0.6;
    if (ctx.bullOB) fvgScore += w.fvg * 0.4;
    score += fvgScore; details.fvg = fvgScore;

    // CRT level (price rejected from range low / discount)
    if (ctx.crtRange) {
      const pd = MarketStructure.premiumDiscount(ctx.crtRange.high, ctx.crtRange.low);
      if (ctx.s.currentPrice >= pd.discount && ctx.s.currentPrice <= pd.mid) {
        score += w.crtLevel; details.crtLevel = w.crtLevel;
      } else if (ctx.s.currentPrice < pd.discount) {
        score += w.crtLevel * 0.5; details.crtLevel = w.crtLevel * 0.5;
      } else details.crtLevel = 0;
    } else details.crtLevel = 0;

    // Momentum
    const momScore = (ctx.momentum / 10) * w.momentum;
    score += momScore; details.momentum = momScore;

    // Spread/vol
    let svScore = 0;
    if (ctx.spreadStatus === 'TIGHT' || ctx.spreadStatus === 'NORMAL') svScore += w.spreadVol * 0.6;
    if (ctx.vol.regime === 'NORMAL' || ctx.vol.regime === 'ELEVATED') svScore += w.spreadVol * 0.4;
    score += svScore; details.spreadVol = svScore;

    // Session
    let sessScore = 0;
    if (ctx.inSession) sessScore = w.session;
    else if (ctx.profile.trades247) sessScore = w.session;
    else sessScore = w.session * 0.3;
    score += sessScore; details.session = sessScore;

    // TBS breakout confirmation
    if (ctx.tbsBreakout.direction === 'BULLISH') {
      score += ctx.tbsBreakout.confidence * 0.15;
    }

    score = Math.min(100, Math.round(score));

    // Entry zone
    let entryZone = null;
    let sl = null, tp = null;
    if (score >= 50) {
      entryZone = this.computeEntryZone(ctx, 'BULLISH');
      const levels = this.computeSLTP(ctx, entryZone, 'BULLISH');
      sl = levels.sl; tp = levels.tp;
    }

    return {
      score, details, entryZone, sl, tp,
      status: this.describeStatus(ctx, 'BULLISH', score)
    };
  },

  scoreBearish(ctx) {
    const w = ctx.profile.confWeights;
    let score = 0;
    const details = {};

    if (ctx.htTrend === 'BEARISH') { score += w.htTrend; details.htTrend = w.htTrend; }
    else if (ctx.htTrend === 'NEUTRAL') { score += w.htTrend * 0.5; details.htTrend = w.htTrend * 0.5; }
    else details.htTrend = 0;

    if (ctx.bearSweep.swept && ctx.bearSweep.rejected) {
      score += w.liquiditySweep; details.liquiditySweep = w.liquiditySweep;
    } else if (ctx.bearSweep.swept) {
      score += w.liquiditySweep * 0.5; details.liquiditySweep = w.liquiditySweep * 0.5;
    } else details.liquiditySweep = 0;

    if (ctx.shift.type && ctx.shift.direction === 'BEARISH') {
      score += w.bosChoch; details.bosChoch = w.bosChoch;
    } else details.bosChoch = 0;

    if (ctx.displacement.bearish) {
      let dScore = ctx.displacement.strength > 1.8 ? w.displacement : w.displacement * 0.7;
      score += dScore; details.displacement = dScore;
    } else details.displacement = 0;

    let fvgScore = 0;
    if (ctx.bearFVG) fvgScore += w.fvg * 0.6;
    if (ctx.bearOB) fvgScore += w.fvg * 0.4;
    score += fvgScore; details.fvg = fvgScore;

    if (ctx.crtRange) {
      const pd = MarketStructure.premiumDiscount(ctx.crtRange.high, ctx.crtRange.low);
      if (ctx.s.currentPrice <= pd.premium && ctx.s.currentPrice >= pd.mid) {
        score += w.crtLevel; details.crtLevel = w.crtLevel;
      } else if (ctx.s.currentPrice > pd.premium) {
        score += w.crtLevel * 0.5; details.crtLevel = w.crtLevel * 0.5;
      } else details.crtLevel = 0;
    } else details.crtLevel = 0;

    const momScore = (ctx.momentum / 10) * w.momentum;
    score += momScore; details.momentum = momScore;

    let svScore = 0;
    if (ctx.spreadStatus === 'TIGHT' || ctx.spreadStatus === 'NORMAL') svScore += w.spreadVol * 0.6;
    if (ctx.vol.regime === 'NORMAL' || ctx.vol.regime === 'ELEVATED') svScore += w.spreadVol * 0.4;
    score += svScore; details.spreadVol = svScore;

    let sessScore = 0;
    if (ctx.inSession) sessScore = w.session;
    else if (ctx.profile.trades247) sessScore = w.session;
    else sessScore = w.session * 0.3;
    score += sessScore; details.session = sessScore;

    if (ctx.tbsBreakout.direction === 'BEARISH') {
      score += ctx.tbsBreakout.confidence * 0.15;
    }

    score = Math.min(100, Math.round(score));

    let entryZone = null, sl = null, tp = null;
    if (score >= 50) {
      entryZone = this.computeEntryZone(ctx, 'BEARISH');
      const levels = this.computeSLTP(ctx, entryZone, 'BEARISH');
      sl = levels.sl; tp = levels.tp;
    }

    return {
      score, details, entryZone, sl, tp,
      status: this.describeStatus(ctx, 'BEARISH', score)
    };
  },

  computeEntryZone(ctx, direction) {
    const price = ctx.s.currentPrice;
    const atr = ctx.vol.atr || VolatilityEngine.atr(ctx.entryCandles);
    if (direction === 'BULLISH') {
      // Entry zone near FVG/OB/discount
      let entryLow = price - atr * 0.3;
      let entryHigh = price + atr * 0.1;
      if (ctx.bullFVG) {
        entryLow = Math.max(entryLow, ctx.bullFVG.bottom);
        entryHigh = Math.min(entryHigh, ctx.bullFVG.top + atr * 0.1);
      }
      if (ctx.bullOB) {
        entryLow = Math.max(entryLow, ctx.bullOB.bottom);
        entryHigh = Math.min(entryHigh, ctx.bullOB.top);
      }
      return { low: entryLow, high: entryHigh };
    } else {
      let entryLow = price - atr * 0.1;
      let entryHigh = price + atr * 0.3;
      if (ctx.bearFVG) {
        entryLow = Math.max(entryLow, ctx.bearFVG.bottom - atr * 0.1);
        entryHigh = Math.min(entryHigh, ctx.bearFVG.top);
      }
      if (ctx.bearOB) {
        entryLow = Math.max(entryLow, ctx.bearOB.bottom);
        entryHigh = Math.min(entryHigh, ctx.bearOB.top);
      }
      return { low: entryLow, high: entryHigh };
    }
  },

  computeSLTP(ctx, entryZone, direction) {
    const profile = ctx.profile;
    const atr = ctx.vol.atr || VolatilityEngine.atr(ctx.entryCandles);
    const volMult = ctx.vol.relativeVol > 1 ? Math.min(ctx.vol.relativeVol, 2) : 1;
    const entry = (entryZone.low + entryZone.high) / 2;

    let sl, tp;
    if (direction === 'BULLISH') {
      // SL: below swing low / ATR
      const swingLow = ctx.sellSideLiq[0]?.price || (entry - atr * profile.slAtrMultiplier);
      sl = Math.min(swingLow, entry - atr * profile.slAtrMultiplier * volMult);
      // TP: target opposite liquidity / RR target
      const rr = profile.minRR;
      tp = entry + (entry - sl) * rr;
      // Cap with buy-side liquidity if closer
      const bsLiq = ctx.buySideLiq[0]?.price;
      if (bsLiq && bsLiq < tp) tp = bsLiq;
    } else {
      const swingHigh = ctx.buySideLiq[0]?.price || (entry + atr * profile.slAtrMultiplier);
      sl = Math.max(swingHigh, entry + atr * profile.slAtrMultiplier * volMult);
      const rr = profile.minRR;
      tp = entry - (sl - entry) * rr;
      const ssLiq = ctx.sellSideLiq[0]?.price;
      if (ssLiq && ssLiq > tp) tp = ssLiq;
    }

    return { sl, tp };
  },

  describeStatus(ctx, direction, score) {
    if (score >= 85) return direction === 'BULLISH' ? 'STRONG BUY SETUP' : 'STRONG SELL SETUP';
    if (score >= 75) return direction === 'BULLISH' ? 'BUY SETUP READY' : 'SELL SETUP READY';
    if (score >= 60) return direction === 'BULLISH' ? 'BULLISH BIAS — CONFIRMING' : 'BEARISH BIAS — CONFIRMING';
    if (score >= 40) return 'SCOUTING SETUP';
    return 'NO SETUP';
  },

  runNoTradeFilters(ctx) {
    const reasons = [];
    if (ctx.spreadStatus === 'EXCESSIVE') reasons.push('Spread excessive');
    if (ctx.spreadStatus === 'WIDE') reasons.push('Spread wide');
    if (ctx.vol.regime === 'HIGH') reasons.push('Volatility extreme');
    if (ctx.vol.regime === 'LOW') reasons.push('Volatility too low / choppy');
    if (!ctx.inSession && !ctx.profile.trades247) reasons.push('Off-hours (low liquidity)');
    if (ctx.setup && ctx.setup.score < ctx.profile.minConfidence) reasons.push('Confidence below threshold');
    if (ctx.setup && ctx.setup.sl && ctx.setup.tp) {
      const entry = ctx.s.currentPrice;
      const risk = Math.abs(entry - ctx.setup.sl);
      const reward = Math.abs(ctx.setup.tp - entry);
      if (risk > 0) {
        const rr = reward / risk;
        if (rr < ctx.profile.minRR) reasons.push(`R:R ${rr.toFixed(1)} below minimum ${ctx.profile.minRR}`);
      }
    }
    return { blocked: reasons.length > 0, reasons };
  }
};
