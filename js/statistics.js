// ============================================
// STATISTICS — Per-asset performance tracking & insights
// ============================================

const Statistics = {
  perAsset: {}, // symbol -> stats
  allTrades: [],
  events: [],

  reset() {
    this.perAsset = {};
    this.allTrades = [];
  },

  getAssetStats(sym) {
    if (!this.perAsset[sym]) {
      this.perAsset[sym] = {
        trades: 0, wins: 0, losses: 0, totalPnL: 0,
        totalRR: 0, avgRR: 0,
        sessions: {}, timeframes: {}, setups: {},
        winVol: [], lossVol: [],
      };
    }
    return this.perAsset[sym];
  },

  onTradeOpened(trade) {
    const st = this.getAssetStats(trade.symbol);
    // Track session
    const session = VolatilityEngine.currentSessionName(trade.profile);
    st.sessions[session] = st.sessions[session] || { trades: 0, wins: 0, pnl: 0 };
  },

  onTradeUpdate(trade, label, pnl) {
    // Partial closes etc.
  },

  onTradeClosed(trade) {
    const st = this.getAssetStats(trade.symbol);
    st.trades++;
    st.allTrades = st.allTrades || [];
    st.allTrades.push({
      direction: trade.direction,
      entry: trade.entry, exit: trade.closePrice,
      pnl: trade.pnl, win: trade.pnl > 0,
      rr: trade.rr, score: trade.score,
      reason: trade.closeReason,
      setup: trade.setup,
    });

    if (trade.pnl > 0) {
      st.wins++;
    } else {
      st.losses++;
    }
    st.totalPnL += trade.pnl;
    st.totalRR += trade.rr;
    st.avgRR = st.totalRR / st.trades;

    this.allTrades.push({ symbol: trade.symbol, ...trade });

    // Render stats UI
    UI.renderStats();
  },

  getWinRate(sym) {
    const st = this.perAsset[sym];
    if (!st || st.trades === 0) return 0;
    return (st.wins / st.trades) * 100;
  },

  // Generate insights / optimization recommendations
  getInsights() {
    const insights = [];
    for (const sym in this.perAsset) {
      const st = this.perAsset[sym];
      if (st.trades < 3) continue;
      const wr = this.getWinRate(sym);

      if (wr < 40) {
        insights.push({
          level: 'bad',
          text: `<strong>${sym}</strong>: Win rate ${wr.toFixed(0)}% over ${st.trades} trades. Consider raising confidence threshold or tightening spread filter for this asset.`
        });
      } else if (wr > 65) {
        insights.push({
          level: 'good',
          text: `<strong>${sym}</strong>: Strong ${wr.toFixed(0)}% win rate (${st.trades} trades). Setups are performing well on this asset.`
        });
      }

      const avgPnL = st.totalPnL / st.trades;
      if (avgPnL > 0) {
        insights.push({
          level: 'good',
          text: `<strong>${sym}</strong>: Avg $${avgPnL.toFixed(2)} per trade. Net $${st.totalPnL.toFixed(2)}.`
        });
      }

      // Check if RR is being met
      if (st.avgRR < 1.5) {
        insights.push({
          level: 'warn',
          text: `<strong>${sym}</strong>: Average RR of 1:${st.avgRR.toFixed(1)} is below target. Consider letting winners run or tightening stops.`
        });
      }
    }
    if (insights.length === 0) {
      insights.push({
        level: 'info',
        text: 'Collecting trading data. Open a few trades or run a backtest to see asset-specific insights.'
      });
    }
    return insights;
  }
};
