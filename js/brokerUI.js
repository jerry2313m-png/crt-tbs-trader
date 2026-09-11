// ============================================
// BROKER UI — Live-account gating + connect flow
// ============================================

const BrokerUI = {

  acknowledged: false,
  execMode: 'demo',
  gateRequirements: {
    minTrades: 50,
    minWinRate: 55,
    maxDD: 5
  },

  init() {
    // Execution mode toggle
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

    this.updateGate();
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
      BrokerAdapters.setActive('simulated');
      document.getElementById('connText').textContent = 'CONNECTED';
      document.getElementById('connDot').className = 'connection-dot connected';
      document.getElementById('connDot').style.background = '';
      document.getElementById('connDot').style.boxShadow = '';
    }
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
      if (f.type === 'select') {
        html += `<div class="form-group">
          <label>${f.label}</label>
          <select class="form-select" data-field="${f.name}">
            ${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}
          </select>
        </div>`;
      } else {
        html += `<div class="form-group">
          <label>${f.label}</label>
          <input type="${f.type}" class="form-input" data-field="${f.name}" placeholder="${f.placeholder || ''}">
        </div>`;
      }
    }
    container.innerHTML = html;
  },

  readCredentials() {
    const creds = {};
    document.querySelectorAll('#brokerFields [data-field]').forEach(el => {
      creds[el.dataset.field] = el.value;
    });
    return creds;
  },

  showRiskAcknowledgement() {
    document.getElementById('modalTitle').textContent = '⚠️ Live Trading Risk Disclosure';
    document.getElementById('modalBody').innerHTML = `
      <div class="risk-ack">
        <p style="color:var(--red);font-weight:700;font-size:13px;margin-bottom:10px">
          BEFORE ENABLING LIVE TRADING, READ THIS CAREFULLY:
        </p>
        <ul>
          <li>The CRT+TBS strategy is a <strong>quantitative framework</strong>, not a guarantee of profit. All trading involves risk of loss.</li>
          <li><strong>Automated trading can lose money rapidly</strong>, including losses exceeding your initial deposit when using leverage.</li>
          <li>Past performance, backtests, and simulated/demo results <strong>do not predict future results</strong>. Live market conditions (slippage, requotes, spread widening during news, gaps, low liquidity) can cause fills materially worse than simulated.</li>
          <li>Technical failures (internet outage, API downtime, bugs, latency) can prevent orders from executing or cause unintended orders.</li>
          <li>You are fully responsible for any and all losses. Use this software entirely at your own risk.</li>
          <li>Never trade with money you cannot afford to lose. Never risk rent, bill, or essential living funds.</li>
          <li>No strategy wins every trade. Drawdowns of 10-20% (or more) are normal even for profitable systems.</li>
        </ul>
        <p style="font-size:12px;color:var(--text-secondary)">
          This application is provided for educational and research purposes. It is not financial advice.
        </p>
        <label class="ack-check">
          <input type="checkbox" id="ackCheck" onchange="BrokerUI.onAckCheck()">
          <span>I have read, understood, and accept all risks. I am solely responsible for my trading decisions.</span>
        </label>
        <button class="ack-btn" id="ackBtn" onclick="BrokerUI.onAckConfirm()" disabled>I Accept — Show Live Gate</button>
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
    const checked = document.getElementById('ackCheck').checked;
    if (!checked) return;
    this.acknowledged = true;
    closeModal();
    this.setExecMode('live');
    this.updateGate();
    Notifications.show('warn', 'Live mode visible', 'You must pass the demo gate and connect a broker to place real orders.');
  },

  updateGate() {
    // Compute stats across ALL trades (open + closed from simulation and paper)
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
      status.textContent = passed ? 'UNLOCKED — LIVE AVAILABLE' : 'LOCKED';
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
    if (!this.updateGate()) {
      Notifications.show('sell', 'Demo gate not passed', 'Complete 50 demo trades with ≥55% win rate and <5% DD first.');
      return;
    }
    const brokerId = document.getElementById('brokerSelect').value;
    BrokerAdapters.setActive(brokerId);
    const creds = this.readCredentials();
    const adapter = BrokerAdapters.getActive();

    if (adapter.id === 'simulated') {
      Notifications.show('info', 'Already in demo mode', 'Switch broker to connect live.');
      return;
    }

    // Verify credentials are present
    const missingFields = (adapter.credentialsFields || []).filter(f => !creds[f.name]);
    if (missingFields.length) {
      Notifications.show('warn', 'Missing credentials', `Fill in: ${missingFields.map(f => f.label).join(', ')}`);
      return;
    }

    Notifications.show('info', 'Connecting…', adapter.name);
    document.getElementById('connText').textContent = 'CONNECTING…';
    document.getElementById('connDot').className = 'connection-dot disconnected';

    const ok = await BrokerAdapters.connect(creds);

    if (ok) {
      document.getElementById('connText').textContent = 'LIVE';
      document.getElementById('connDot').className = 'connection-dot connected';
      document.getElementById('connDot').style.background = 'var(--red)';
      document.getElementById('connDot').style.boxShadow = '0 0 8px var(--red-glow)';
      ExecutionEngine.liveMode = true;
      ExecutionEngine.useBrokerAdapter = true;
      Notifications.show('buy', 'Connected to ' + adapter.name, 'Live trading is now active. USE EXTREME CAUTION.');
    } else {
      document.getElementById('connText').textContent = 'CONNECTED (DEMO)';
      document.getElementById('connDot').className = 'connection-dot connected';
      document.getElementById('connDot').style.background = '';
      document.getElementById('connDot').style.boxShadow = '';
      Notifications.alert('Broker Connection Failed', `
        <p>Could not establish a live connection to <strong>${adapter.name}</strong>.</p>
        <p style="margin-top:10px">This is expected in this sandboxed preview. To trade live you need:</p>
        <ul style="padding-left:20px;margin-top:8px;font-size:12px;color:var(--text-secondary)">
          <li>A running bridge API for MT4/MT5, or API keys for cTrader/Binance</li>
          <li>Network access to your broker / exchange</li>
          <li>Properly configured CORS and authentication</li>
        </ul>
        <p style="margin-top:10px;font-size:12px;color:var(--text-secondary)">
          The broker adapter framework is in place (<code>js/brokerAdapters.js</code>)
          and ready to wire to your chosen bridge. The app remains in <strong>simulated mode</strong>
          and will not place real orders until a broker connection is successfully established.
        </p>
      `);
    }
  }
};

// Boot hook
window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('executionMode')) {
    setTimeout(() => BrokerUI.init(), 100);
  }
});
