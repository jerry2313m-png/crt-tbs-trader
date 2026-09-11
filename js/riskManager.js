// ============================================
// RISK MANAGER — Position sizing, daily limits, equity protection
// ============================================

const RiskManager = {

  state: {
    balance: 10000,
    equity: 10000,
    todayPnL: 0,
    todayTrades: 0,
    todayWins: 0,
    todayLosses: 0,
    consecutiveLosses: 0,
    maxDrawdown: 0,
    peakEquity: 10000,
    riskPerTrade: 0.01, // 1%
    riskProfile: 'balanced',
    smallAccount: false,
    maxDailyLossPct: 5,
    dailyTargetPct: 3,
    maxDailyTrades: 10,
    maxConsecutiveLosses: 5,
    stopAtTarget: true,
    partialTP: true,
    breakEven: true,
    trailingStop: true,
    minConfidence: 75,
    minRR: 2.0,
  },

  loadSettings() {
    this.state.balance = parseFloat(document.getElementById('accountBalance')?.value || 10000);
    this.state.smallAccount = document.getElementById('smallAccountMode')?.checked || false;
    this.state.partialTP = document.getElementById('partialTP')?.checked ?? true;
    this.state.breakEven = document.getElementById('breakEven')?.checked ?? true;
    this.state.trailingStop = document.getElementById('trailingStop')?.checked ?? true;
    this.state.maxDailyLossPct = parseFloat(document.getElementById('maxDailyLoss')?.value || 5);
    this.state.dailyTargetPct = parseFloat(document.getElementById('dailyTarget')?.value || 3);
    this.state.maxDailyTrades = parseInt(document.getElementById('maxDailyTrades')?.value || 10);
    this.state.maxConsecutiveLosses = parseInt(document.getElementById('maxConsecLoss')?.value || 5);
    this.state.stopAtTarget = document.getElementById('stopAtTarget')?.checked ?? true;
    this.state.minConfidence = parseInt(document.getElementById('confSlider')?.value || 75);
    this.state.minRR = parseFloat(document.getElementById('rrSlider')?.value || 2);

    const profile = document.getElementById('riskProfile')?.value || 'balanced';
    this.state.riskProfile = profile;
    switch (profile) {
      case 'conservative': this.state.riskPerTrade = 0.005; break;
      case 'balanced': this.state.riskPerTrade = 0.01; break;
      case 'aggressive': this.state.riskPerTrade = 0.02; break;
      case 'custom': this.state.riskPerTrade = parseFloat(document.getElementById('riskSlider')?.value || 1) / 100; break;
    }
  },

  calculatePositionSize(symbol, profile, entry, sl) {
    const riskPct = this.state.riskPerTrade;
    const riskAmount = this.state.equity * riskPct;
    const riskPerUnit = Math.abs(entry - sl);
    if (riskPerUnit <= 0) return { lot: 0, invalid: true };

    const contractSize = profile.contractSize;
    const tickValue = profile.pointValue;
    // Value per 1.0 lot per point movement
    const pointProfit = contractSize * tickValue;
    // How many points risked
    const pointsRisked = riskPerUnit / tickValue;
    // Lot = riskAmount / (pointsRisked * pointProfit)
    let lot = riskAmount / (pointsRisked * pointProfit);

    // Round to lot step
    const step = profile.lotStep;
    lot = Math.floor(lot / step) * step;

    // Apply limits
    lot = Math.max(profile.minLot, Math.min(profile.maxLot, lot));

    // Small account checks
    if (this.state.smallAccount) {
      const marginReq = this.estimateMargin(symbol, profile, lot, entry);
      if (marginReq > this.state.equity * 0.5) {
        // Reduce lot
        lot = (this.state.equity * 0.4 / marginReq) * lot;
        lot = Math.floor(lot / step) * step;
        lot = Math.max(profile.minLot, lot);
      }
      if (lot < profile.minLot) return { lot: 0, invalid: true, reason: 'Lot size below minimum' };
      const freeMargin = this.state.equity - this.usedMargin();
      if (marginReq > freeMargin) return { lot: 0, invalid: true, reason: 'Insufficient margin' };
    }

    // Cap for large accounts / sanity
    if (lot <= 0) return { lot: 0, invalid: true };
    return {
      lot: Math.round(lot * 1000) / 1000,
      riskAmount,
      pointsRisked,
      margin: this.estimateMargin(symbol, profile, lot, entry)
    };
  },

  estimateMargin(sym, profile, lot, price) {
    // Roughly 1% margin for forex, more for indices/crypto
    const leverage = this.state.smallAccount ? 100 : 500;
    if (profile.assetClass === 'FOREX') return (lot * profile.contractSize * price) / leverage;
    if (profile.assetClass === 'GOLD') return (lot * profile.contractSize * price) / leverage;
    if (profile.assetClass === 'CRYPTO') return (lot * profile.contractSize * price) / 10;
    if (profile.assetClass === 'INDEX') return (lot * profile.contractSize * price) / 100;
    return lot * price;
  },

  usedMargin() {
    let m = 0;
    for (const t of ExecutionEngine.trades.open) {
      m += t.margin || 0;
    }
    return m;
  },

  canTrade(sym, setup, score) {
    const reasons = [];
    if (this.state.todayPnL < -this.state.balance * (this.state.maxDailyLossPct / 100)) {
      reasons.push(`Daily loss limit reached ($${Math.abs(this.state.todayPnL).toFixed(2)})`);
    }
    if (this.state.stopAtTarget && this.state.todayPnL > this.state.balance * (this.state.dailyTargetPct / 100)) {
      reasons.push('Daily profit target reached');
    }
    if (this.state.todayTrades >= this.state.maxDailyTrades) {
      reasons.push('Max daily trades reached');
    }
    if (this.state.consecutiveLosses >= this.state.maxConsecutiveLosses) {
      reasons.push(`Max consecutive losses (${this.state.maxConsecutiveLosses}) reached`);
    }
    if (score < this.state.minConfidence) {
      reasons.push(`Confidence ${score} < ${this.state.minConfidence}`);
    }
    return { canTrade: reasons.length === 0, reasons };
  },

  recordTradeResult(pnl, win) {
    this.state.todayPnL += pnl;
    this.state.equity += pnl;
    this.state.todayTrades++;
    if (win) {
      this.state.todayWins++;
      this.state.consecutiveLosses = 0;
    } else {
      this.state.todayLosses++;
      this.state.consecutiveLosses++;
    }
    if (this.state.equity > this.state.peakEquity) this.state.peakEquity = this.state.equity;
    const dd = (this.state.peakEquity - this.state.equity) / this.state.peakEquity * 100;
    if (dd > this.state.maxDrawdown) this.state.maxDrawdown = dd;
  },

  resetDaily() {
    this.state.todayPnL = 0;
    this.state.todayTrades = 0;
    this.state.todayWins = 0;
    this.state.todayLosses = 0;
    this.state.consecutiveLosses = 0;
  },

  getWinRate() {
    if (this.state.todayTrades === 0) return 0;
    return (this.state.todayWins / this.state.todayTrades) * 100;
  },

  getDailyRiskUsed() {
    const maxLoss = this.state.balance * (this.state.maxDailyLossPct / 100);
    if (this.state.todayPnL >= 0) return 0;
    return Math.min(100, (Math.abs(this.state.todayPnL) / maxLoss) * 100);
  },

  getDailyProgress() {
    const target = this.state.balance * (this.state.dailyTargetPct / 100);
    if (this.state.todayPnL <= 0) return 0;
    return Math.min(100, (this.state.todayPnL / target) * 100);
  }
};
