// ============================================
// APP — Main controller / bootstrap
// ============================================

const App = {
  state: {
    tradingMode: 'auto',
    selectedSymbol: 'XAUUSD',
    running: false,
  },

  init() {
    Notifications.init();
    DataFeed.init();
    Charts.init();
    ExecutionEngine.init();
    RiskManager.loadSettings();
    Statistics.reset();

    // Populate backtest select
    const btSym = document.getElementById('btSymbol');
    for (const item of DataFeed.WATCHLIST) {
      const opt = document.createElement('option');
      opt.value = item.sym; opt.textContent = item.sym;
      if (item.sym === 'XAUUSD') opt.selected = true;
      btSym.appendChild(opt);
    }

    UI.init();

    // Subscribe to data feed ticks
    DataFeed.subscribe(() => this.onTick());

    this.state.running = true;
    Notifications.show('info', 'CRT+TBS Trader initialized', 'Paper trading active. Analyzing markets…');
  },

  onTick() {
    // Run strategy on all symbols
    for (const item of DataFeed.WATCHLIST) {
      Strategy.analyze(item.sym, DataFeed);
    }

    // Check entries if auto-trading
    ExecutionEngine.checkEntries(Strategy.currentSignals);

    // Update UI at ~5fps
    if (!this._lastUiUpdate || Date.now() - this._lastUiUpdate > 200) {
      this._lastUiUpdate = Date.now();
      UI.update();
    }
  }
};

// Global action handlers
function toggleAutoTrading() {
  RiskManager.loadSettings();
  const running = ExecutionEngine.toggleAuto();
  UI.updateTradeButton();
  if (running) {
    Notifications.show('buy', 'Auto-trading activated', `Risk ${(RiskManager.state.riskPerTrade * 100).toFixed(1)}% per trade • ${RiskManager.state.minConfidence}+ score`);
  } else {
    Notifications.show('warn', 'Auto-trading stopped', 'Existing positions remain managed.');
  }
}

function togglePaperMode() {
  if (ExecutionEngine.liveMode) {
    BrokerUI.setExecMode('demo');
    ExecutionEngine.paperMode = true;
  } else {
    BrokerUI.showRiskAcknowledgement();
  }
  UI.updateTradeButton();
}

function saveSettings() {
  RiskManager.loadSettings();
  Notifications.show('info', 'Settings saved', `Risk ${(RiskManager.state.riskPerTrade * 100).toFixed(1)}% • Min score ${RiskManager.state.minConfidence}`);
}

function updateRiskProfile() {
  const sel = document.getElementById('riskProfile').value;
  const slider = document.getElementById('riskSlider');
  switch (sel) {
    case 'conservative': slider.value = 0.5; break;
    case 'balanced': slider.value = 1; break;
    case 'aggressive': slider.value = 2; break;
  }
  UI.updateRiskDisplays();
}

function updateRiskDisplay() { UI.updateRiskDisplays(); }
function updateConfDisplay() { UI.updateRiskDisplays(); }
function updateRRDisplay() { UI.updateRiskDisplays(); }

function runBacktest() {
  const sym = document.getElementById('btSymbol').value;
  const tf = document.getElementById('btTimeframe').value;
  const bars = parseInt(document.getElementById('btBars').value);
  const balance = parseFloat(document.getElementById('btBalance').value);

  const bt = Backtest.run(sym, tf, bars, balance);
  const r = bt.results.crt_tbs;

  document.getElementById('btResults').style.display = 'block';
  document.getElementById('btTrades').textContent = r.totalTrades;
  document.getElementById('btWinRate').textContent = r.winRate.toFixed(1) + '%';
  const pf = document.getElementById('btProfit');
  pf.textContent = (r.netProfit >= 0 ? '+' : '') + '$' + r.netProfit.toFixed(2);
  pf.className = 'stat-value ' + (r.netProfit >= 0 ? 'green' : 'red');
  document.getElementById('btPF').textContent = r.profitFactor > 0 ? r.profitFactor.toFixed(2) : '∞';
  document.getElementById('btDD').textContent = r.maxDD.toFixed(1) + '%';
  document.getElementById('btRR').textContent = '1:' + r.avgRR.toFixed(1);

  // Show comparison breakdown
  Notifications.alert('Backtest Complete: ' + sym, `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
      <div style="background:var(--bg-elevated);padding:8px;border-radius:6px;text-align:center">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">CRT</div>
        <div style="font-size:13px;font-weight:700;margin-top:3px">${bt.results.crt.totalTrades}T</div>
        <div style="font-size:11px;color:var(--text-muted)">${bt.results.crt.winRate.toFixed(0)}% WR</div>
        <div style="font-size:12px;color:${bt.results.crt.netProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${bt.results.crt.netProfit >= 0 ? '+' : ''}$${bt.results.crt.netProfit.toFixed(0)}</div>
      </div>
      <div style="background:var(--bg-elevated);padding:8px;border-radius:6px;text-align:center">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase">TBS</div>
        <div style="font-size:13px;font-weight:700;margin-top:3px">${bt.results.tbs.totalTrades}T</div>
        <div style="font-size:11px;color:var(--text-muted)">${bt.results.tbs.winRate.toFixed(0)}% WR</div>
        <div style="font-size:12px;color:${bt.results.tbs.netProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${bt.results.tbs.netProfit >= 0 ? '+' : ''}$${bt.results.tbs.netProfit.toFixed(0)}</div>
      </div>
      <div style="background:var(--accent);opacity:0.9;padding:8px;border-radius:6px;text-align:center">
        <div style="font-size:10px;opacity:0.8;text-transform:uppercase">CRT+TBS</div>
        <div style="font-size:13px;font-weight:700;margin-top:3px;color:#fff">${bt.results.crt_tbs.totalTrades}T</div>
        <div style="font-size:11px;opacity:0.8;color:#fff">${bt.results.crt_tbs.winRate.toFixed(0)}% WR</div>
        <div style="font-size:12px;color:#fff;font-weight:600">${bt.results.crt_tbs.netProfit >= 0 ? '+' : ''}$${bt.results.crt_tbs.netProfit.toFixed(0)}</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--text-muted)">Profit factor: ${r.profitFactor.toFixed(2)} • Max DD: ${r.maxDD.toFixed(1)}% • Avg RR: 1:${r.avgRR.toFixed(1)}</div>
  `);

  setTimeout(() => Charts.drawEquity(bt.results), 50);
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});
