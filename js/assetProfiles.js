// ============================================
// ASSET PROFILES — Adaptive per-class defaults
// ============================================

const ASSET_PROFILES = {
  FOREX: {
    name: 'Forex',
    badge: 'forex',
    color: '#3b82f6',
    icon: 'FX',
    // ATR multiplier for SL
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    // Spread
    maxSpreadPoints: 25,
    typicalSpreadPoints: 12,
    // Displacement
    minDisplacementPct: 0.3,
    // Volatility (pct per day typical)
    typicalDailyRangePct: 0.8,
    lowVolatilityPct: 0.4,
    highVolatilityPct: 1.5,
    // Session priority (UTC hours)
    sessions: {
      london: { start: 7, end: 16, weight: 1.2 },
      newyork: { start: 12, end: 21, weight: 1.3 },
      asia: { start: 23, end: 8, weight: 0.7 }
    },
    prioritySessions: ['london', 'newyork'],
    trades247: false,
    weekend: false,
    // Position sizing
    defaultLotSize: 1.0,
    minLot: 0.01,
    maxLot: 100,
    lotStep: 0.01,
    contractSize: 100000,
    // CRT ranges
    crtLookback: 20,
    liquidityLookback: 50,
    // Confidence weights (additive scoring)
    confWeights: {
      htTrend: 15, liquiditySweep: 20, bosChoch: 15, displacement: 15,
      fvg: 10, crtLevel: 10, momentum: 5, spreadVol: 5, session: 5
    },
    minConfidence: 75,
    minRR: 2.0,
    // TP stages (fraction of full TP)
    tpLevels: [0.33, 0.66, 1.0],
    tpCloseFractions: [0.3, 0.3, 0.4],  // how much to close at each TP
    trailingStopActivation: 0.5,  // activate trailing after 50% to TP1
    breakEvenAt: 0.33,  // move SL to entry after TP1
    decimals: 5,
    pointValue: 0.0001,
  },

  GOLD: {
    name: 'Gold (XAUUSD)',
    badge: 'gold',
    color: '#f59e0b',
    icon: 'Au',
    slAtrMultiplier: 1.8,
    tpAtrMultiplier: 3.5,
    maxSpreadPoints: 50,
    typicalSpreadPoints: 25,
    minDisplacementPct: 0.5,
    typicalDailyRangePct: 1.5,
    lowVolatilityPct: 0.7,
    highVolatilityPct: 3.0,
    sessions: {
      london: { start: 7, end: 16, weight: 1.3 },
      newyork: { start: 12, end: 21, weight: 1.4 },
      asia: { start: 23, end: 8, weight: 0.5 }
    },
    prioritySessions: ['london', 'newyork'],
    trades247: false,
    weekend: false,
    defaultLotSize: 0.1,
    minLot: 0.01,
    maxLot: 50,
    lotStep: 0.01,
    contractSize: 100,
    crtLookback: 15,
    liquidityLookback: 40,
    confWeights: {
      htTrend: 12, liquiditySweep: 25, bosChoch: 15, displacement: 18,
      fvg: 8, crtLevel: 8, momentum: 5, spreadVol: 5, session: 4
    },
    minConfidence: 78,
    minRR: 2.0,
    tpLevels: [0.3, 0.6, 1.0],
    tpCloseFractions: [0.25, 0.35, 0.4],
    trailingStopActivation: 0.4,
    breakEvenAt: 0.3,
    decimals: 2,
    pointValue: 0.01,
    // Gold-specific: stronger sweep detection, faster moves
    requireStrongDisplacement: true,
    sweepVolumeThreshold: 1.5,
  },

  CRYPTO: {
    name: 'Crypto',
    badge: 'crypto',
    color: '#f97316',
    icon: '₿',
    slAtrMultiplier: 2.0,
    tpAtrMultiplier: 4.0,
    maxSpreadPoints: 200,
    typicalSpreadPoints: 50,
    minDisplacementPct: 0.8,
    typicalDailyRangePct: 4.0,
    lowVolatilityPct: 1.5,
    highVolatilityPct: 10.0,
    sessions: null, // 24/7
    prioritySessions: [],
    trades247: true,
    weekend: true,
    defaultLotSize: 0.01,
    minLot: 0.001,
    maxLot: 100,
    lotStep: 0.001,
    contractSize: 1,
    crtLookback: 25,
    liquidityLookback: 60,
    confWeights: {
      htTrend: 18, liquiditySweep: 20, bosChoch: 15, displacement: 15,
      fvg: 10, crtLevel: 7, momentum: 5, spreadVol: 7, session: 3
    },
    minConfidence: 73,
    minRR: 1.8,
    tpLevels: [0.25, 0.5, 1.0],
    tpCloseFractions: [0.2, 0.3, 0.5],
    trailingStopActivation: 0.3,
    breakEvenAt: 0.25,
    decimals: 2,
    pointValue: 0.01,
    volatilityAdaptive: true,
  },

  INDEX: {
    name: 'Index',
    badge: 'index',
    color: '#8b5cf6',
    icon: 'Idx',
    slAtrMultiplier: 1.6,
    tpAtrMultiplier: 3.2,
    maxSpreadPoints: 100,
    typicalSpreadPoints: 30,
    minDisplacementPct: 0.4,
    typicalDailyRangePct: 1.2,
    lowVolatilityPct: 0.5,
    highVolatilityPct: 2.5,
    sessions: {
      london: { start: 7, end: 16, weight: 1.0 },
      newyork: { start: 13, end: 21, weight: 1.4 },
      asia: { start: 0, end: 6, weight: 0.3 }
    },
    prioritySessions: ['newyork'],
    trades247: false,
    weekend: false,
    defaultLotSize: 0.1,
    minLot: 0.01,
    maxLot: 50,
    lotStep: 0.01,
    contractSize: 1,
    crtLookback: 18,
    liquidityLookback: 45,
    confWeights: {
      htTrend: 15, liquiditySweep: 20, bosChoch: 15, displacement: 15,
      fvg: 10, crtLevel: 10, momentum: 5, spreadVol: 5, session: 5
    },
    minConfidence: 76,
    minRR: 2.0,
    tpLevels: [0.33, 0.66, 1.0],
    tpCloseFractions: [0.3, 0.3, 0.4],
    trailingStopActivation: 0.5,
    breakEvenAt: 0.33,
    decimals: 2,
    pointValue: 0.1,
  }
};

// Specific symbol overrides (for unique tick sizes etc.)
const SYMBOL_OVERRIDES = {
  BTCUSD: { decimals: 2, pointValue: 0.01, slAtrMultiplier: 2.2, tpAtrMultiplier: 4.5 },
  ETHUSD: { decimals: 2, pointValue: 0.01 },
  XAUUSD: { decimals: 2, pointValue: 0.01 },
  USDJPY: { decimals: 3, pointValue: 0.01 },
  US30:  { decimals: 1, pointValue: 0.1 },
  NAS100:{ decimals: 1, pointValue: 0.1 },
  SPX500:{ decimals: 1, pointValue: 0.1 },
};
