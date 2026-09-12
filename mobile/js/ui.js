// ============================================
// UI — Rendering & interactions
// ============================================

const UI = {
  activeTab: 'dashboard',
  activeSymbol: 'XAUUSD',
  activeAssetClass: 'ALL',
  activeTradesSubtab: 'open',

  init() {
    this.renderSymbolTabs();
    this.renderMarkets();
    this.renderAssetClassTabs();
    this.renderStats();
    this.updateTradeButton();
    this.updateRiskDisplays();
    this.hookupSettings();
    this.updateClock();
    setInterval(() => this.updateClock(), 1000);
  },

  updateClock() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const el = document.getElementById('clockDisplay');
    if (el) el.textContent = `${h}:${m}:${s}`;
  },

  renderSymbolTabs() {
    const container = document.getElementById('symbolTabs');
    container.innerHTML = '';
    for (const item of DataFeed.WATCHLIST) {
      const s = DataFeed.get(item.sym);
      const btn = document.createElement('div');
      btn.className = 'symbol-tab' + (item.sym === this.activeSymbol ? ' active' : '');
      btn.onclick = () => this.selectSymbol(item.sym);
      const chg = s ? ((s.currentPrice - s.prevDayOpen) / s.prevDayOpen * 100) : 0;
      btn.innerHTML = `
        <div>${item.sym}</div>
        <span class="sym-price">${s ? s.currentPrice.toFixed(s.profile.decimals) : '--'}</span>
      `;
      container.appendChild(btn);
    }
  },

  selectSymbol(sym) {
    this.activeSymbol = sym;
    this.renderSymbolTabs();
    this.update();
  },

  renderMarkets() {
    const list = document.getElementById('marketList');
    list.innerHTML = '';
    const search = (document.getElementById('marketSearch')?.value || '').toUpperCase();

    for (const item of DataFeed.WATCHLIST) {
      const s = DataFeed.get(item.sym);
      if (!s) continue;
      if (this.activeAssetClass !== 'ALL' && s.profile.assetClass !== this.activeAssetClass) continue;
      if (search && !item.sym.includes(search) && !s.profile.name.toUpperCase().includes(search)) continue;

      const chg = ((s.currentPrice - s.prevDayOpen) / s.prevDayOpen * 100);
      const chgClass = chg >= 0 ? 'up' : 'down';
      const div = document.createElement('div');
      div.className = 'market-item' + (item.sym === this.activeSymbol ? ' active' : '');
      div.onclick = () => { this.selectSymbol(item.sym); this.switchTab('dashboard'); };
      div.innerHTML = `
        <div class="mi-left">
          <div class="mi-icon ${s.profile.badge}">${s.profile.icon}</div>
          <div>
            <div class="mi-sym">${item.sym}</div>
            <div class="mi-name">${AssetDetector.displayName(item.sym)}</div>
          </div>
        </div>
        <div class="mi-right">
          <div class="mi-price">${s.currentPrice.toFixed(s.profile.decimals)}</div>
          <div class="mi-chg ${chgClass}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</div>
          <div class="mi-spread">Spr: ${(s.spread / s.profile.pointValue).toFixed(1)} pts</div>
        </div>
      `;
      list.appendChild(div);
    }
  },

  renderAssetClassTabs() {
    const container = document.getElementById('assetClassTabs');
    const classes = ['ALL', 'FOREX', 'GOLD', 'CRYPTO', 'INDEX'];
    container.innerHTML = '';
    for (const c of classes) {
      const btn = document.createElement('div');
      btn.className = 'class-tab' + (this.activeAssetClass === c ? ' active' : '');
      btn.textContent = c;
      btn.onclick = () => { this.activeAssetClass = c; this.renderAssetClassTabs(); this.renderMarkets(); };
      container.appendChild(btn);
    }
  },

  update() {
    this.updateDashboard();
    this.renderSymbolTabs();
    this.renderMarkets();
    this.refreshTrades();
  },

  updateDashboard() {
    const sym = this.activeSymbol;
    const s = DataFeed.get(sym);
    const sig = Strategy.currentSignals[sym];
    if (!s || !sig) return;
    const prof = s.profile;

    // Asset name & type
    document.getElementById('assetName').textContent = sym;
    const badge = document.getElementById('assetType');
    badge.textContent = prof.assetClass;
    badge.className = 'asset-type-badge ' + prof.badge;

    // Price
    document.getElementById('assetPrice').textContent = s.currentPrice.toFixed(prof.decimals);
    const chg = ((s.currentPrice - s.prevDayOpen) / s.prevDayOpen * 100);
    const chgEl = document.getElementById('assetChange');
    chgEl.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    chgEl.className = 'asset-change ' + (chg >= 0 ? 'up' : 'down');

    // Signal badge
    const sb = document.getElementById('signalBadge');
    const sLabel = document.getElementById('signalLabel');
    const sSub = document.getElementById('signalSub');
    sb.className = 'signal-badge';

    if (sig.noTrade?.blocked) {
      sb.classList.add('waiting');
      sLabel.textContent = 'NO TRADE';
      sSub.textContent = sig.noTrade.reasons.join(' • ') || 'Conditions not met';
    } else if (sig.setup?.ready || sig.setup?.score >= RiskManager.state.minConfidence) {
      sb.classList.add(sig.setup.direction === 'BUY' ? 'buy' : 'sell');
      sLabel.textContent = sig.setup.direction === 'BUY' ? 'BUY SETUP' : 'SELL SETUP';
      sSub.textContent = `${sig.setup.status} — Score ${sig.setup.score}/100`;
    } else if (sig.setup?.score >= 60) {
      sb.classList.add('waiting');
      sLabel.textContent = sig.setup.direction === 'BUY' ? 'BULLISH BIAS' : 'BEARISH BIAS';
      sSub.textContent = `${sig.setup.status} — ${sig.setup.score}/100`;
    } else {
      sLabel.textContent = 'ANALYZING';
      sSub.textContent = 'Scanning market structure…';
    }

    // Confidence
    const score = sig.setup?.score || 0;
    document.getElementById('confValue').textContent = score + '/100';
    document.getElementById('confFill').style.width = score + '%';

    // Structure grid
    const trendEl = document.getElementById('trendValue');
    trendEl.textContent = sig.trend;
    trendEl.className = 'stat-value ' + (sig.trend === 'BULLISH' ? 'bull' : sig.trend === 'BEARISH' ? 'bear' : '');

    // Structure status
    let structText = 'RANGE';
    if (sig.shift.type) {
      structText = `${sig.shift.direction === 'BULLISH' ? '▲' : '▼'} ${sig.shift.type}`;
    }
    const structEl = document.getElementById('structureValue');
    structEl.textContent = structText;
    structEl.className = 'stat-value ' + (sig.shift.direction === 'BULLISH' ? 'bull' : sig.shift.direction === 'BEARISH' ? 'bear' : '');

    // CRT status
    let crtText = 'Mapping range';
    if (sig.bullSweep.swept && sig.bullSweep.rejected) crtText = 'SSL Swept ✔';
    else if (sig.bearSweep.swept && sig.bearSweep.rejected) crtText = 'BSL Swept ✔';
    else if (sig.bullSweep.swept) crtText = 'Sweeping SSL…';
    else if (sig.bearSweep.swept) crtText = 'Sweeping BSL…';
    else if (sig.crtRange) crtText = `${sig.crtRange.source} Range`;
    document.getElementById('crtStatus').textContent = crtText;

    // Entry zone
    let ezText = '—';
    if (sig.setup?.entryZone) {
      const ez = sig.setup.entryZone;
      ezText = `${ez.low.toFixed(prof.decimals)} — ${ez.high.toFixed(prof.decimals)}`;
    }
    document.getElementById('entryZone').textContent = ezText;

    // Parameters
    document.getElementById('atrValue').textContent = sig.volatility.atr ? sig.volatility.atr.toFixed(prof.decimals) : '—';
    document.getElementById('spreadValue').textContent = (s.spread / prof.pointValue).toFixed(1) + ' pts';
    document.getElementById('riskValue').textContent = (RiskManager.state.riskPerTrade * 100).toFixed(1) + '%';

    // SL/TP
    if (sig.setup?.sl && sig.setup?.tp) {
      document.getElementById('slValue').textContent = sig.setup.sl.toFixed(prof.decimals);
      document.getElementById('tpValue').textContent = sig.setup.tp.toFixed(prof.decimals);
      const rr = sig.setup.rr || Math.abs(sig.setup.tp - s.currentPrice) / Math.abs(s.currentPrice - sig.setup.sl);
      document.getElementById('rrValue').textContent = '1:' + rr.toFixed(1);

      // Lot size
      const ps = RiskManager.calculatePositionSize(sym, prof, s.currentPrice, sig.setup.sl);
      document.getElementById('lotValue').textContent = ps.lot ? ps.lot.toFixed(2) : '—';
    } else {
      document.getElementById('slValue').textContent = '—';
      document.getElementById('tpValue').textContent = '—';
      document.getElementById('rrValue').textContent = '—';
      document.getElementById('lotValue').textContent = '—';
    }

    // Session
    document.getElementById('sessionBadge').textContent = VolatilityEngine.currentSessionName(prof).split(' / ')[0] || 'OFF';

    // Daily stats
    document.getElementById('todayTrades').textContent = RiskManager.state.todayTrades;
    document.getElementById('winRate').textContent = RiskManager.getWinRate().toFixed(0) + '%';
    const plEl = document.getElementById('todayPL');
    plEl.textContent = (RiskManager.state.todayPnL >= 0 ? '+' : '') + '$' + RiskManager.state.todayPnL.toFixed(2);
    plEl.className = 'stat-value small ' + (RiskManager.state.todayPnL >= 0 ? 'green' : 'red');
    document.getElementById('drawdown').textContent = RiskManager.state.maxDrawdown.toFixed(1) + '%';

    document.getElementById('riskUsed').style.width = RiskManager.getDailyRiskUsed() + '%';
    document.getElementById('riskUsedLabel').textContent = RiskManager.getDailyRiskUsed().toFixed(0) + '%';
    document.getElementById('dailyProgress').style.width = RiskManager.getDailyProgress() + '%';
    document.getElementById('dailyProgressLabel').textContent = RiskManager.getDailyProgress().toFixed(0) + '%';

    // Chart
    Charts.drawPrice(sym);
  },

  refreshTrades() {
    const container = document.getElementById('tradesList');
    container.innerHTML = '';

    let trades = [];
    if (this.activeTradesSubtab === 'open') trades = ExecutionEngine.trades.open;
    else if (this.activeTradesSubtab === 'pending') trades = ExecutionEngine.trades.pending;
    else trades = ExecutionEngine.trades.closed;

    document.getElementById('openCount').textContent = ExecutionEngine.trades.open.length;
    document.getElementById('pendingCount').textContent = ExecutionEngine.trades.pending.length;

    if (!trades.length) {
      container.innerHTML = `<div class="empty-state">No ${this.activeTradesSubtab} positions</div>`;
      return;
    }

    for (const t of trades) {
      const prof = t.profile || AssetDetector.getProfile(t.symbol);
      const div = document.createElement('div');
      div.className = 'trade-item ' + (t.direction === 'BUY' ? 'buy' : 'sell');

      let pnlDisplay = '';
      if (t.pnl !== undefined) {
        pnlDisplay = `<div class="tg-val ${t.pnl >= 0 ? 'profit' : 'loss'}">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</div>`;
      }

      let progress = '';
      if (t.tp && t.sl && this.activeTradesSubtab !== 'history') {
        const s = DataFeed.get(t.symbol);
        const price = s ? s.currentPrice : t.entry;
        const risk = Math.abs(t.entry - t.sl);
        const reward = Math.abs(t.tp - t.entry);
        const move = t.direction === 'BUY' ? price - t.entry : t.entry - price;
        const pct = Math.max(0, Math.min(100, (move / reward) * 100));
        progress = `<div class="tp-progress"><div class="tp-fill" style="width:${pct}%"></div></div>`;
      }

      const closeBtn = this.activeTradesSubtab === 'open'
        ? `<button class="trade-close-btn" onclick="ExecutionEngine.closeTradeById('${t.id}')">CLOSE</button>`
        : '';

      const tpStatus = [];
      if (t.tp1Hit) tpStatus.push('TP1✓');
      if (t.tp2Hit) tpStatus.push('TP2✓');
      if (t.trailingActive) tpStatus.push('Trail');

      div.innerHTML = `
        <div class="trade-header">
          <span class="trade-sym">${t.symbol}</span>
          <span class="trade-side ${t.direction === 'BUY' ? 'buy' : 'sell'}">${t.direction}</span>
        </div>
        <div class="trade-grid">
          <div><div class="tg-label">Entry</div><div class="tg-val">${t.entry.toFixed(prof.decimals)}</div></div>
          <div><div class="tg-label">Size</div><div class="tg-val">${t.lot.toFixed(2)}</div></div>
          <div><div class="tg-label">R:R</div><div class="tg-val">1:${(t.rr || 2).toFixed(1)}</div></div>
          <div><div class="tg-label">SL</div><div class="tg-val">${t.sl ? t.sl.toFixed(prof.decimals) : '—'}</div></div>
          <div><div class="tg-label">TP</div><div class="tg-val">${t.tp ? t.tp.toFixed(prof.decimals) : '—'}</div></div>
          <div><div class="tg-label">P/L</div>${pnlDisplay}</div>
        </div>
        ${progress ? `<div class="trade-footer">
          <span style="font-size:10px;color:var(--text-muted)">${tpStatus.join(' • ') || (t.closeReason || 'Running')}</span>
          <div class="trade-progress">${progress}</div>
          ${closeBtn}
        </div>` : closeBtn ? `<div class="trade-footer">${closeBtn}</div>` : ''}
      `;
      container.appendChild(div);
    }
  },

  updateTradeButton() {
    const btn = document.getElementById('btnTrade');
    const txt = document.getElementById('btnTradeText');
    if (ExecutionEngine.autoTrading) {
      btn.classList.add('active');
      txt.textContent = ExecutionEngine.liveMode ? 'STOP LIVE TRADING' : 'Stop Auto Trade';
    } else {
      btn.classList.remove('active');
      txt.textContent = ExecutionEngine.liveMode ? 'START LIVE TRADING' : 'Start Auto Trade';
    }

    const pBtn = document.getElementById('btnPaper');
    const spans = pBtn.querySelectorAll('span');
    if (ExecutionEngine.liveMode) {
      pBtn.style.background = 'var(--red-dim)';
      pBtn.style.color = 'var(--red)';
      pBtn.style.borderColor = 'var(--red)';
      spans[1].textContent = 'Live Mode';
    } else {
      pBtn.style.background = 'var(--green-dim)';
      pBtn.style.color = 'var(--green)';
      pBtn.style.borderColor = 'var(--green)';
      spans[1].textContent = 'Paper Trading';
    }
  },

  renderStats() {
    const container = document.getElementById('assetStats');
    if (!container) return;
    container.innerHTML = '';

    for (const sym in Statistics.perAsset) {
      const st = Statistics.perAsset[sym];
      if (st.trades === 0) continue;
      const wr = Statistics.getWinRate(sym);
      const div = document.createElement('div');
      div.className = 'asset-stat-row';
      div.innerHTML = `
        <div class="as-left">
          <span class="as-sym">${sym}</span>
          <span class="as-wr">${wr.toFixed(0)}% WR</span>
        </div>
        <div class="as-right">
          <span class="as-trades">${st.trades}T</span>
          <span class="as-pnl ${st.totalPnL >= 0 ? 'green' : 'red'}">${st.totalPnL >= 0 ? '+' : ''}$${st.totalPnL.toFixed(2)}</span>
        </div>
      `;
      container.appendChild(div);
    }
    if (!container.children.length) {
      container.innerHTML = '<div class="empty-state">No trades recorded yet.</div>';
    }

    // Insights
    const ins = document.getElementById('insightsList');
    if (ins) {
      const insights = Statistics.getInsights();
      ins.innerHTML = insights.map(i => `<div class="insight-item ${i.level}">${i.text}</div>`).join('');
    }
  },

  hookupSettings() {
    document.getElementById('modeSelector')?.addEventListener('click', e => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      App.state.tradingMode = btn.dataset.mode;
    });
  },

  updateRiskDisplays() {
    const r = document.getElementById('riskSlider');
    const c = document.getElementById('confSlider');
    const rr = document.getElementById('rrSlider');
    if (r) {
      document.getElementById('riskSliderVal').textContent = parseFloat(r.value).toFixed(1) + '%';
    }
    if (c) {
      document.getElementById('confSliderVal').textContent = c.value + '/100';
    }
    if (rr) {
      document.getElementById('rrSliderVal').textContent = '1:' + parseFloat(rr.value).toFixed(1);
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab)?.classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.classList.add('active');
    if (tab === 'backtest') {
      // Populate backtest symbol select
      const sel = document.getElementById('btSymbol');
      if (sel && !sel.options.length) {
        for (const item of DataFeed.WATCHLIST) {
          const opt = document.createElement('option');
          opt.value = item.sym; opt.textContent = item.sym;
          sel.appendChild(opt);
        }
      }
      Charts.resize();
    }
    if (tab === 'stats') this.renderStats();
  },

  switchTradesTab(stab) {
    this.activeTradesSubtab = stab;
    document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
    document.querySelector(`.subtab[data-stab="${stab}"]`)?.classList.add('active');
    this.refreshTrades();
  }
};

// Tab switching (global)
function switchTab(tab) { UI.switchTab(tab); }
function switchTradesTab(stab) { UI.switchTradesTab(stab); }
function filterMarkets() { UI.renderMarkets(); }
