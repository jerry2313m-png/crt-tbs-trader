// ============================================
// EXECUTION ENGINE — Open, manage, close trades
// ============================================

const ExecutionEngine = {
  trades: { open: [], pending: [], closed: [] },
  autoTrading: false,
  paperMode: true,
  liveMode: false,
  useBrokerAdapter: false,
  lastTradeTime: {}, // symbol -> last trade timestamp
  COOLDOWN_MS: 60000 * 5, // 5 min cooldown per symbol after close

  init() {
    // Tick trades every second
    setInterval(() => this.manageTrades(), 1000);
  },

  toggleAuto() {
    this.autoTrading = !this.autoTrading;
    return this.autoTrading;
  },

  checkEntries(signals) {
    if (!this.autoTrading) return;
    for (const sym in signals) {
      const sig = signals[sym];
      if (!sig?.setup?.ready && sig?.setup?.score < RiskManager.state.minConfidence) continue;
      if (sig.noTrade?.blocked) continue;
      if (!sig.setup?.sl || !sig.setup?.tp) continue;

      // Cooldown
      const lastT = this.lastTradeTime[sym] || 0;
      if (Date.now() - lastT < this.COOLDOWN_MS) continue;

      // Already have open position for this symbol?
      if (this.trades.open.some(t => t.symbol === sym)) continue;

      const { canTrade, reasons } = RiskManager.canTrade(sym, sig.setup, sig.setup.score);
      if (!canTrade) {
        if (reasons.some(r => r.includes('Daily loss') || r.includes('profit target'))) {
          if (this.autoTrading) {
            this.autoTrading = false;
            Notifications.show('warn', 'Auto-trading stopped', reasons[0]);
            UI.updateTradeButton();
          }
        }
        continue;
      }

      const profile = AssetDetector.getProfile(sym);
      const s = DataFeed.get(sym);
      const entry = s.currentPrice;
      const sl = sig.setup.sl;
      const tp = sig.setup.tp;
      const direction = sig.setup.direction;

      // Position size
      const ps = RiskManager.calculatePositionSize(sym, profile, entry, sl);
      if (ps.invalid) continue;

      // Check RR
      const risk = Math.abs(entry - sl);
      const reward = Math.abs(tp - entry);
      const rr = reward / risk;
      if (rr < RiskManager.state.minRR) continue;

      // Check broker specs
      const specs = {
        minLot: profile.minLot,
        maxLot: profile.maxLot,
        lotStep: profile.lotStep,
        spread: s.spread,
        maxSpread: profile.maxSpreadPoints * profile.pointValue,
      };
      if (specs.spread > specs.maxSpread) continue;

      // In live mode route through broker adapter
      if (this.liveMode && this.useBrokerAdapter && BrokerAdapters.isLive()) {
        this.routeBrokerOrder({
          symbol: sym, direction, entry, sl, tp,
          lot: ps.lot, score: sig.setup.score, rr, margin: ps.margin,
          profile, setup: sig.setup.status, atr: sig.volatility.atr
        });
        return;
      }
      // Realistic execution costs: spread crossing + slippage + commission
      const commission = this.computeCommission(profile, ps.lot);
      const slip = VolatilityEngine.estimateSlippage(DataFeed.getCandles(sym, 'M5'), profile);
      const slipSide = direction === 'BUY' ? 1 : -1;
      // Apply ask/bid spread crossing plus random slippage
      const execEntry = direction === 'BUY'
        ? s.ask + slip * (0.3 + Math.random() * 0.7)
        : s.bid - slip * (0.3 + Math.random() * 0.7);
      const execSL = sl;
      const execTP = tp;
      const realRR = Math.abs(execTP - execEntry) / Math.max(0.000001, Math.abs(execEntry - execSL));
      if (realRR < RiskManager.state.minRR * 0.9) continue; // reject if costs kill RR

      // Fallback: simulated
      this.openTrade({
        symbol: sym,
        direction,
        entry: execEntry,
        sl: execSL,
        tp: execTP,
        lot: ps.lot,
        score: sig.setup.score,
        rr: realRR,
        margin: ps.margin,
        profile,
        setup: sig.setup.status,
        atr: sig.volatility.atr,
        commission,
        simulated: true,
      });
    }
  },

  async routeBrokerOrder(opts) {
    const side = opts.direction === 'BUY' ? 'buy' : 'sell';
    try {
      const result = await BrokerAdapters.getActive().marketOrder(
        opts.symbol, side, opts.lot, opts.sl, opts.tp, `CRT+TBS score=${opts.score}`
      );
      if (result && result.orderId) {
        this.openTrade({ ...opts, entry: result.openPrice, brokerOrderId: result.orderId, simulated: false });
      } else {
        Notifications.show('sell', 'Order rejected', `${opts.symbol} — broker did not confirm.`);
      }
    } catch (e) {
      Notifications.show('sell', 'Order failed', `${opts.symbol}: ${e.message || e}`);
    }
  },

  openTrade(opts) {
    const trade = {
      id: 'T' + Date.now() + Math.floor(Math.random() * 1000),
      symbol: opts.symbol,
      direction: opts.direction,
      entry: opts.entry,
      originalEntry: opts.entry,
      sl: opts.sl,
      tp: opts.tp,
      lot: opts.lot,
      score: opts.score,
      rr: opts.rr,
      margin: opts.margin,
      profile: opts.profile,
      setup: opts.setup,
      atr: opts.atr,
      commission: opts.commission || 0,
      openTime: Date.now(),
      tp1Hit: false, tp2Hit: false, tp3Hit: false,
      breakEvenSet: false,
      trailingActive: false,
      trailingHigh: opts.entry,
      trailingLow: opts.entry,
      pnl: -(opts.commission || 0) / 2, // start with opening commission deducted
      status: 'OPEN',
      partialClosed: 0,
      closeFractions: opts.profile.tpCloseFractions,
      tpLevels: opts.profile.tpLevels,
      simulated: opts.simulated !== false,
    };
    this.trades.open.push(trade);
    this.lastTradeTime[opts.symbol] = Date.now();
    Notifications.show(
      opts.direction === 'BUY' ? 'buy' : 'sell',
      `${opts.direction} ${opts.symbol} @ ${this.fmt(opts.entry, opts.profile)}`,
      `SL: ${this.fmt(opts.sl, opts.profile)} | TP: ${this.fmt(opts.tp, opts.profile)} | RR: 1:${opts.rr.toFixed(1)} | Score: ${opts.score}`
    );
    UI.refreshTrades();
    Statistics.onTradeOpened(trade);
  },

  manageTrades() {
    for (let i = this.trades.open.length - 1; i >= 0; i--) {
      const t = this.trades.open[i];
      const s = DataFeed.get(t.symbol);
      if (!s) continue;
      const price = s.currentPrice;
      const prof = t.profile;

      // Current P&L
      const pointMove = t.direction === 'BUY' ? (price - t.entry) : (t.entry - price);
      const pointValue = prof.contractSize * prof.pointValue;
      t.pnl = pointMove / prof.pointValue * pointValue * t.lot * (1 - t.partialClosed);

      // Track extremes for trailing
      if (t.direction === 'BUY') {
        t.trailingHigh = Math.max(t.trailingHigh, price);
      } else {
        t.trailingLow = Math.min(t.trailingLow, price);
      }

      const risk = Math.abs(t.entry - t.sl);
      const reward = Math.abs(t.tp - t.entry);
      const progress = pointMove / reward;

      // TP stages
      if (RiskManager.state.partialTP && !t.tp1Hit && progress >= t.tpLevels[0]) {
        t.tp1Hit = true;
        this.partialClose(t, t.closeFractions[0], 'TP1');
        if (RiskManager.state.breakEven) {
          t.sl = t.originalEntry + (t.direction === 'BUY' ? -prof.pointValue : prof.pointValue);
          t.breakEvenSet = true;
          Notifications.show('info', 'Break-even set', `${t.symbol} SL moved to entry`);
        }
      }
      if (RiskManager.state.partialTP && !t.tp2Hit && t.tp1Hit && progress >= t.tpLevels[1]) {
        t.tp2Hit = true;
        this.partialClose(t, t.closeFractions[1], 'TP2');
      }

      // Trailing stop
      if (RiskManager.state.trailingStop && progress >= prof.trailingStopActivation) {
        t.trailingActive = true;
        const trailDist = t.atr * 0.8;
        if (t.direction === 'BUY') {
          const newSL = t.trailingHigh - trailDist;
          if (newSL > t.sl) t.sl = newSL;
        } else {
          const newSL = t.trailingLow + trailDist;
          if (newSL < t.sl) t.sl = newSL;
        }
      }

      // Check SL / final TP
      if (t.direction === 'BUY') {
        if (price <= t.sl) { this.closeTrade(i, 'SL'); continue; }
        if (price >= t.tp && t.tp3Hit === false) { this.closeTrade(i, 'TP3'); continue; }
      } else {
        if (price >= t.sl) { this.closeTrade(i, 'SL'); continue; }
        if (price <= t.tp && t.tp3Hit === false) { this.closeTrade(i, 'TP3'); continue; }
      }
    }
  },

  partialClose(t, fraction, label) {
    const realized = t.pnl * fraction / (1 - t.partialClosed);
    t.partialClosed += fraction * (1 - t.partialClosed);
    RiskManager.recordTradeResult(realized, true);
    Notifications.show('buy', `${label} hit — ${t.symbol}`, `Partial close +${this.fmtMoney(realized)}`);
    Statistics.onTradeUpdate(t, label, realized);
  },

  closeTrade(index, reason) {
    const t = this.trades.open[index];
    const s = DataFeed.get(t.symbol);
    const exitPrice = s.currentPrice;
    const prof = t.profile;

    let closePnL = t.pnl - (t.commission / 2); // subtract closing commission
    t.pnl = closePnL;
    t.closePrice = exitPrice;
    t.closeReason = reason;
    t.closeTime = Date.now();
    t.status = 'CLOSED';

    const win = closePnL > 0;
    RiskManager.recordTradeResult(closePnL, win);
    this.trades.closed.unshift(t);
    this.trades.open.splice(index, 1);
    this.lastTradeTime[t.symbol] = Date.now();

    if (reason.startsWith('TP')) {
      Notifications.show('buy', `${reason} hit — ${t.symbol}`, `${win ? '+' : ''}${this.fmtMoney(closePnL)}`);
    } else {
      Notifications.show('sell', `Stop loss — ${t.symbol}`, `${this.fmtMoney(closePnL)}`);
    }
    Statistics.onTradeClosed(t);
    UI.refreshTrades();
  },

  closeTradeById(id) {
    const idx = this.trades.open.findIndex(t => t.id === id);
    if (idx >= 0) this.closeTrade(idx, 'MANUAL');
  },

  // Realistic commission (per side, in account currency)
  // Roughly mimics ECN-style: $3/lot/side FX, $3.5/lot Gold, 0.04% crypto notional, $0.5/lot index
  computeCommission(profile, lot) {
    const mult = this.liveMode ? 1 : 1;
    switch (profile.assetClass) {
      case 'FOREX':  return lot * 3.0 * mult * 2; // both sides
      case 'GOLD':   return lot * 3.5 * mult * 2;
      case 'CRYPTO': return lot * (profile.contractSize || 1) * 0.0004 * mult; // 0.04% notional one side
      case 'INDEX':  return lot * 0.5 * mult * 2;
      default: return lot * 2.0 * mult * 2;
    }
  },

  fmt(v, prof) {
    return v.toFixed(prof?.decimals || 5);
  },
  fmtMoney(v) {
    const sign = v >= 0 ? '+' : '-';
    return sign + '$' + Math.abs(v).toFixed(2);
  }
};
