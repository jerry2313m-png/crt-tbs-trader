// ============================================
// CHARTS — Lightweight canvas-based price chart
// ============================================

const Charts = {

  priceCanvas: null,
  priceCtx: null,
  equityCanvas: null,
  equityCtx: null,
  width: 0,
  height: 0,
  animFrame: null,

  init() {
    this.priceCanvas = document.getElementById('priceChart');
    this.priceCtx = this.priceCanvas.getContext('2d');
    this.equityCanvas = document.getElementById('equityChart');
    this.equityCtx = this.equityCanvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    if (this.priceCanvas) {
      const rect = this.priceCanvas.parentElement.getBoundingClientRect();
      this.priceCanvas.width = rect.width - 28; // padding
      this.priceCanvas.height = 200;
    }
    if (this.equityCanvas) {
      const rect = this.equityCanvas.parentElement.getBoundingClientRect();
      this.equityCanvas.width = rect.width - 28;
      this.equityCanvas.height = 140;
    }
  },

  drawPrice(sym) {
    if (!this.priceCtx) return;
    const ctx = this.priceCtx;
    const w = this.priceCanvas.width;
    const h = this.priceCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const s = DataFeed.get(sym);
    if (!s) return;
    const sig = Strategy.currentSignals[sym];
    const profile = s.profile;

    // Use entry timeframe candles
    const tf = sig?.timeframes?.entry || 'M15';
    let candles = DataFeed.getCandles(sym, tf);
    if (!candles.length) return;
    candles = candles.slice(-60);

    const maxP = Math.max(...candles.map(c => c.high));
    const minP = Math.min(...candles.map(c => c.low));
    const pad = (maxP - minP) * 0.1;
    const top = maxP + pad;
    const bot = minP - pad;
    const range = top - bot;
    const cw = w / candles.length;
    const bw = Math.max(2, cw * 0.7);

    const y = p => h - ((p - bot) / range) * h;

    // Grid
    ctx.strokeStyle = '#232d45';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 5; i++) {
      const py = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    }

    // Liquidity lines
    if (sig) {
      const drawLiq = (price, color, label) => {
        if (!price || price < bot || price > top) return;
        ctx.strokeStyle = color;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y(price)); ctx.lineTo(w, y(price)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.fillText(label, 2, y(price) - 3);
      };
      if (sig.crtRange) {
        drawLiq(sig.crtRange.high, '#f59e0b', 'RH');
        drawLiq(sig.crtRange.low, '#f59e0b', 'RL');
      }
      sig.buySideLiq?.slice(0, 1).forEach(l => drawLiq(l.price, '#8b5cf6', 'BSL'));
      sig.sellSideLiq?.slice(0, 1).forEach(l => drawLiq(l.price, '#8b5cf6', 'SSL'));

      // FVG shading
      const drawFVG = (fvg, color) => {
        if (!fvg) return;
        ctx.fillStyle = color;
        const y1 = y(fvg.top), y2 = y(fvg.bottom);
        ctx.fillRect(0, Math.min(y1, y2), w, Math.abs(y2 - y1));
      };
      drawFVG(sig.bullFVG, 'rgba(6,182,212,0.12)');
      drawFVG(sig.bearFVG, 'rgba(239,68,68,0.12)');

      // SL/TP lines if setup ready
      if (sig.setup?.sl && sig.setup?.tp && sig.setup.score >= 60) {
        drawLiq(sig.setup.sl, '#ef4444', 'SL');
        drawLiq(sig.setup.tp, '#10b981', 'TP');
      }
    }

    // Candles
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const bullish = c.close >= c.open;
      const color = bullish ? '#10b981' : '#ef4444';
      const x = i * cw + cw / 2;
      const yO = y(c.open), yC = y(c.close), yH = y(c.high), yL = y(c.low);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();

      ctx.fillStyle = color;
      const top = Math.min(yO, yC);
      const bodyH = Math.max(1, Math.abs(yO - yC));
      ctx.fillRect(x - bw / 2, top, bw, bodyH);
    }

    // Current price line
    const cp = s.currentPrice;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(0, y(cp)); ctx.lineTo(w, y(cp)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3b82f6';
    ctx.fillRect(w - 60, y(cp) - 8, 60, 16);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(cp.toFixed(profile.decimals), w - 4, y(cp) + 3);
    ctx.textAlign = 'left';
  },

  drawEquity(results) {
    if (!this.equityCtx || !results) return;
    const ctx = this.equityCtx;
    const w = this.equityCanvas.width;
    const h = this.equityCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const all = results.crt_tbs.trades;
    if (!all || !all.length) return;

    let eq = RiskManager.state.balance;
    const points = [eq];
    for (const t of all) {
      eq += t.pnl;
      points.push(eq);
    }

    const maxE = Math.max(...points);
    const minE = Math.min(...points);
    const rng = maxE - minE || 1;

    // Grid
    ctx.strokeStyle = '#232d45';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 4; i++) {
      const py = (h / 3) * i;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(w, py); ctx.stroke();
    }

    // Start line
    const startY = h - ((points[0] - minE) / rng) * h;
    ctx.strokeStyle = '#5a6a87';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, startY); ctx.lineTo(w, startY); ctx.stroke();
    ctx.setLineDash([]);

    // Equity curve
    ctx.strokeStyle = points[points.length - 1] >= points[0] ? '#10b981' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      const px = (i / (points.length - 1)) * w;
      const py = h - ((points[i] - minE) / rng) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Fill
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, points[points.length - 1] >= points[0] ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)');
    grad.addColorStop(1, 'rgba(16,185,129,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Start/end labels
    ctx.fillStyle = '#8a98b5';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText('$' + points[0].toFixed(0), 2, h - 4);
    ctx.fillStyle = points[points.length - 1] >= points[0] ? '#10b981' : '#ef4444';
    ctx.textAlign = 'right';
    ctx.fillText('$' + points[points.length - 1].toFixed(0), w - 2, 12);
    ctx.textAlign = 'left';
  }
};
