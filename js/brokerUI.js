// ============================================
// BROKER UI — Live-account gating + connect flow
// ============================================

const BrokerUI = {
  acknowledged: false,
  execMode: 'demo',
  _gatePassed: false,
  _connectedAdapter: null,

  gateRequirements: {
    minTrades: 50,
    minWinRate: 55,
    maxDD: 5
  },

  init() {
    document.querySelectorAll('#executionMode .mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.exec;
        if (mode === 'live') {
          this.showRiskAcknowledgement();
        } else {
          this.setExecMode('demo');
        }
      });
    });

    // Broker selection change
    document.getElementById('brokerSelect').addEventListener('change', () => {
      this.renderBrokerFields();
      // Reset connection state on change
      if (BrokerAdapters.active !== 'simulated') {
        BrokerAdapters.disconnect();
        this.setConnStatus('disconnected', 'DEMO');
      }
      BrokerAdapters.setActive('simulated');
    });

    this.renderBrokerFields();
    this.updateGate();

    // Periodic MT5 position/status sync
    setInterval(() => this.syncBrokerState(), 2000);
  },

  setExecMode(mode) {
    this.execMode = mode;
    document.querySelectorAll('#executionMode .mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.exec === mode);
    });
    document.getElementById('riskWarning').style.display = mode === 'live' ? 'block' : 'none';
    document.getElementById('demoGate').style.display = mode === 'live' ? 'block' : 'none';
    document.getElementById('connectBtn').style.display = mode === 'live' ? 'block' : 'none';
    ExecutionEngine.liveMode = mode === 'live';
    if (mode === 'demo') {
      ExecutionEngine.useBrokerAdapter = false;
      if (BrokerAdapters.active !== 'simulated') {
        BrokerAdapters.disconnect();
        BrokerAdapters.setActive('simulated');
      }
      this.setConnStatus('connected', 'CONNECTED');
    }
    this.updateGate();
  },

  renderBrokerFields() {
    const sel = document.getElementById('brokerSelect');
    const container = document.getElementById('brokerFields');
    const brokerId = sel.value;
    const adapter = BrokerAdapters.adapters[brokerId];

    if (!adapter || !adapter.credentialsFields) {
      container.innerHTML = '';
      return;
    }
    let html = '';
    for (const f of adapter.credentialsFields) {
      if (f.type === 'static') {
        html += `<div class="form-group" style="font-size:12px;color:var(--text-secondary);padding:10px;background:var(--bg-elevated);border-radius:var(--radius-sm);">${f.note || f.label}</div>`;
      } else if (f.type === 'select') {
        html += `<div class="form-group">
          <label>${f.label}</label>
          <select class="form-select" data-field="${f.name}">
            ${f.options.map(o => `<option value="${o}" ${o === f.default ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>`;
      } else {
        html += `<div class="form-group">
          <label>${f.label}</label>
          <input type="${f.type}" class="form-input" data-field="${f.name}" placeholder="${f.placeholder || ''}" value="${f.default || ''}" autocomplete="${f.type === 'password' ? 'new-password' : 'off'}">
        </div>`;
      }
    }

    // Connection status display
    html += `<div id="brokerStatus" style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:var(--bg-elevated);border-radius:var(--radius-sm);margin-top:4px;">
      <span style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Connection</span>
      <span class="conn-status disconnected" id="brokerStatusBadge">DISCONNECTED</span>
    </div>
    <div id="brokerAccountInfo" style="display:none;margin-top:8px;font-size:12px;background:var(--bg-elevated);border-radius:var(--radius-sm);padding:10px;"></div>`;

    container.innerHTML = html;
  },

  readCredentials() {
    const creds = {};
    document.querySelectorAll('#brokerFields [data-field]').forEach(el => {
      creds[el.dataset.field] = el.value;
    });
    return creds;
  },

  setConnStatus(status, label) {
    const dot = document.getElementById('connDot');
    const txt = document.getElementById('connText');
    const badge = document.getElementById('brokerStatusBadge');
    if (dot && txt) {
      dot.className = 'connection-dot ' + (status === 'connected' ? 'connected' : status === 'connecting' ? '' : 'disconnected');
      txt.textContent = label;
      if (status === 'connected' && ExecutionEngine.liveMode) {
        dot.style.background = 'var(--red)';
        dot.style.boxShadow = '0 0 8px var(--red-glow)';
      } else {
        dot.style.background = '';
        dot.style.boxShadow = '';
      }
    }
    if (badge) {
      badge.className = 'conn-status ' + status;
      badge.textContent = label;
    }
  },

  showRiskAcknowledgement() {
    document.getElementById('modalTitle').textContent = '⚠️ Live / Broker Trading Risk Disclosure';
    document.getElementById('modalBody').innerHTML = `
      <div class="risk-ack">
        <p style="color:var(--red);font-weight:700;font-size:13px;margin-bottom:10px">
          BEFORE CONNECTING TO A REAL BROKER, READ THIS CAREFULLY:
        </p>
        <ul>
          <li>The CRT+TBS strategy is a <strong>quantitative framework</strong>, not a guarantee of profit. All trading involves risk of loss.</li>
          <li><strong>Automated trading can lose money rapidly</strong>, including losses exceeding your initial deposit when using leverage.</li>
          <li>Past performance, backtests, and simulated/demo results <strong>do not predict future results</strong>. Live market conditions (slippage, requotes, spread widening during news, gaps, low liquidity) can cause fills materially worse than simulated.</li>
          <li>Technical failures (internet outage, API downtime, bugs, latency, MT5 crashes) can prevent orders from executing or cause unintended orders.</li>
          <li>You are fully responsible for any and all losses. Use this software entirely at your own risk.</li>
          <li>Never trade with money you cannot afford to lose. Never risk rent, bill, or essential living funds.</li>
          <li>Always test on a <strong>DEMO account first</strong> for weeks before live capital.</li>
        </ul>
        <p style="font-size:12px;color:var(--text-secondary)">
          This application is provided for educational and research purposes. It is not financial advice.
        </p>
        <label class="ack-check">
          <input type="checkbox" id="ackCheck" onchange="BrokerUI.onAckCheck()">
          <span>I have read, understood, and accept all risks. I am solely responsible for my trading decisions.</span>
        </label>
        <button class="ack-btn" id="ackBtn" onclick="BrokerUI.onAckConfirm()" disabled>I Accept — Show Broker Settings</button>
      </div>
    `;
    document.getElementById('alertModal').classList.add('show');
  },

  onAckCheck() {
    const checked = document.getElementById('ackCheck').checked;
    const btn = document.getElementById('ackBtn');
    btn.disabled = !checked;
    btn.classList.toggle('enabled', checked);
  },

  onAckConfirm() {
    const checked = document.getElementById('ackCheck')?.checked;
    if (!checked) return;
    this.acknowledged = true;
    closeModal();
    this.setExecMode('live');
    this.updateGate();
    Notifications.show('warn', 'Live/broker mode visible', 'Connect to your MT5 bridge, then pass the demo gate before trading.');
  },

  updateGate() {
    const allClosed = ExecutionEngine.trades.closed;
    const total = allClosed.length;
    const wins = allClosed.filter(t => t.pnl > 0).length;
    const winRate = total ? (wins / total) * 100 : 0;
    const dd = RiskManager.state.maxDrawdown;

    const req = this.gateRequirements;
    const tradeScore = Math.min(100, (total / req.minTrades) * 50);
    const wrScore = Math.min(100, Math.max(0, (winRate - 40) / (req.minWinRate - 40)) * 30);
    const ddScore = dd <= req.maxDD ? 20 : Math.max(0, 20 - (dd - req.maxDD) * 4);
    const gateScore = Math.min(100, tradeScore + wrScore + ddScore);
    const passed = total >= req.minTrades && winRate >= req.minWinRate && dd <= req.maxDD;

    const fill = document.getElementById('gateFill');
    const pct = document.getElementById('gatePct');
    const status = document.getElementById('gateStatus');
    const stats = document.getElementById('gateStats');
    if (fill) fill.style.width = gateScore + '%';
    if (pct) pct.textContent = Math.round(gateScore) + '%';
    if (status) {
      status.textContent = passed ? 'UNLOCKED — TRADING ALLOWED' : 'LOCKED';
      status.className = 'gate-status ' + (passed ? 'unlocked' : '');
    }
    if (stats) {
      stats.innerHTML = `
        Trades: <strong>${total}/${req.minTrades}</strong> &nbsp;•&nbsp;
        Win rate: <strong style="color:${winRate>=req.minWinRate?'var(--green)':'var(--red)'}">${winRate.toFixed(0)}%/${req.minWinRate}%</strong> &nbsp;•&nbsp;
        Max DD: <strong style="color:${dd<=req.maxDD?'var(--green)':'var(--red)'}">${dd.toFixed(1)}%/${req.maxDD}%</strong>
      `;
    }

    this._gatePassed = passed;
    return passed;
  },

  async connect() {
    if (!this.acknowledged) {
      this.showRiskAcknowledgement();
      return;
    }

    // If simulated/paper, no gate required
    const brokerId = document.getElementById('brokerSelect').value;
    BrokerAdapters.setActive(brokerId);

    if (brokerId === 'simulated') {
      this.setExecMode('demo');
      BrokerAdapters.setActive('simulated');
      const ok = await BrokerAdapters.connect({});
      if (ok) {
        this.setConnStatus('connected', 'CONNECTED');
        this.showAccountInfo(null);
        ExecutionEngine.useBrokerAdapter = false;
      }
      return;
    }

    // For live brokers, gate applies
    if (!this.updateGate()) {
      Notifications.show('sell', 'Demo gate not passed', 'Complete 50 demo trades with ≥55% win rate and <5% DD first.');
      return;
    }

    const creds = this.readCredentials();
    const adapter = BrokerAdapters.getActive();

    // Validate required fields
    const missing = (adapter.credentialsFields || [])
      .filter(f => f.type !== 'static' && !creds[f.name] && f.name !== 'accountType');
    if (missing.length) {
      Notifications.show('warn', 'Missing fields', 'Fill in: ' + missing.map(f => f.label).join(', '));
      return;
    }

    this.setConnStatus('connecting', 'CONNECTING…');
    try {
      const ok = await BrokerAdapters.connect(creds);
      if (ok) {
        // Fetch account info
        const acc = await adapter.getAccountInfo();
        this.showAccountInfo(acc);

        const isLive = creds.accountType === 'LIVE';
        ExecutionEngine.liveMode = isLive;
        ExecutionEngine.useBrokerAdapter = true;

        if (isLive) {
          this.setConnStatus('connected', 'LIVE — ' + acc.server);
          Notifications.show('sell', '⚠️ LIVE ACCOUNT CONNECTED', `${acc.login}@${acc.server} • Balance $${acc.balance.toFixed(2)}. REAL MONEY IS AT RISK.`);
        } else {
          this.setConnStatus('connected', 'DEMO — ' + acc.server);
          Notifications.show('buy', 'Demo account connected', `${acc.login}@${acc.server} • Balance $${acc.balance.toFixed(2)}`);
        }
      }
    } catch (e) {
      this.setConnStatus('disconnected', 'DISCONNECTED');
      Notifications.alert('Broker Connection Failed', `
        <p style="margin-bottom:10px"><strong>Could not connect to ${adapter.name}.</strong></p>
        <p style="color:var(--text-secondary);font-size:12px">${(e.message || e).replace(/</g, '&lt;')}</p>
        <div style="margin-top:14px;padding:12px;background:var(--bg-elevated);border-radius:8px;font-size:12px;color:var(--text-secondary)">
          <strong style="color:var(--text-primary);display:block;margin-bottom:6px">For MetaTrader 5:</strong>
          1. MT5 must be installed &amp; running on your PC<br>
          2. Install dependencies: <code style="background:var(--bg-primary);padding:2px 5px;border-radius:3px">pip install MetaTrader5 flask flask-cors</code><br>
          3. Run the bridge: <code style="background:var(--bg-primary);padding:2px 5px;border-radius:3px">python mt5_bridge.py</code><br>
          4. Make sure MT5 allows algorithmic trading (Tools → Options → Expert Advisors → "Allow Algorithmic Trading")<br>
          5. Keep the bridge URL at <code style="background:var(--bg-primary);padding:2px 5px;border-radius:3px">http://localhost:8080</code><br>
          6. If the web app is served from GitHub Pages (https), browsers block http://localhost on some platforms. Run the bridge and open <code style="background:var(--bg-primary);padding:2px 5px;border-radius:3px">http://localhost:8080</code> directly (the bridge serves the same app).
        </div>
      `);
    }
  },

  showAccountInfo(acc) {
    const el = document.getElementById('brokerAccountInfo');
    if (!el) return;
    if (!acc) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-family:var(--font-mono);font-size:12px">
        <div><span style="color:var(--text-muted);font-family:var(--font-main);font-size:10px;text-transform:uppercase">Login</span><br>${acc.login || '—'}</div>
        <div><span style="color:var(--text-muted);font-family:var(--font-main);font-size:10px;text-transform:uppercase">Server</span><br>${acc.server || '—'}</div>
        <div><span style="color:var(--text-muted);font-family:var(--font-main);font-size:10px;text-transform:uppercase">Balance</span><br>$${(acc.balance||0).toFixed(2)}</div>
        <div><span style="color:var(--text-muted);font-family:var(--font-main);font-size:10px;text-transform:uppercase">Equity</span><br>$${(acc.equity||0).toFixed(2)}</div>
        <div><span style="color:var(--text-muted);font-family:var(--font-main);font-size:10px;text-transform:uppercase">Free Margin</span><br>$${(acc.freeMargin||0).toFixed(2)}</div>
        <div><span style="color:var(--text-muted);font-family:var(--font-main);font-size:10px;text-transform:uppercase">Leverage</span><br>1:${acc.leverage || '—'}</div>
      </div>
    `;
    // Sync balance into risk manager
    if (acc.balance) {
      RiskManager.state.balance = acc.balance;
      RiskManager.state.equity = acc.equity || acc.balance;
    }
  },

  async syncBrokerState() {
    if (!BrokerAdapters.isLive() && BrokerAdapters.active === 'simulated') return;
    try {
      const adapter = BrokerAdapters.getActive();
      if (!adapter.getOpenPositions) return;
      // Sync broker positions into the engine so they show in the UI
      const bpositions = await adapter.getOpenPositions();
      if (!bpositions || !bpositions.length) return;
      // Merge broker positions into open trades (don't duplicate)
      for (const bp of bpositions) {
        const existing = ExecutionEngine.trades.open.find(t => t.brokerOrderId == bp.orderId);
        if (!existing) {
          const prof = AssetDetector.getProfile(bp.symbol);
          ExecutionEngine.trades.open.push({
            id: 'B' + bp.orderId,
            brokerOrderId: bp.orderId,
            symbol: bp.symbol,
            direction: bp.side,
            entry: bp.openPrice,
            originalEntry: bp.openPrice,
            sl: bp.sl,
            tp: bp.tp,
            lot: bp.lot,
            score: 0,
            rr: bp.sl && bp.tp ? Math.abs(bp.tp - bp.openPrice) / Math.abs(bp.openPrice - bp.sl) : 2,
            margin: 0,
            profile: prof,
            setup: 'From broker',
            atr: VolatilityEngine.atr(DataFeed.getCandles(bp.symbol, 'M15'), 14),
            openTime: bp.openTime,
            tp1Hit: false, tp2Hit: false, tp3Hit: false,
            breakEvenSet: false, trailingActive: false,
            trailingHigh: bp.openPrice, trailingLow: bp.openPrice,
            pnl: bp.pnl || 0,
            status: 'OPEN',
            partialClosed: 0,
            closeFractions: prof.tpCloseFractions,
            tpLevels: prof.tpLevels,
            simulated: false,
            fromBroker: true,
          });
        } else {
          // Update PnL from broker
          existing.pnl = bp.pnl || existing.pnl;
        }
      }
    } catch (e) { /* silent */ }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  // init is called by a setTimeout in app.js; harmless to re-guard
  if (document.getElementById('executionMode')) {
    setTimeout(() => BrokerUI.init(), 100);
  }
});
