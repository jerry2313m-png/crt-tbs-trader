# CRT + TBS Adaptive Multi-Asset Trader

A professional mobile-first PWA that implements the **Candle Range Theory (CRT) + Trading Breakout/Sweep (TBS)** strategy across Forex, Gold, Crypto, and Indices.

**Live demo:** https://arena-ai.github.io/crt-tbs-trader/  *(or your own GitHub Pages URL once deployed)*

## Features

- **Auto asset detection** — normalizes broker symbol suffixes (`m`, `.a`, `.r`, etc.) and classifies into FOREX / GOLD / CRYPTO / INDEX with per-class parameters (ATR multipliers, spread tolerance, displacement thresholds, sessions, contract specs)
- **CRT framework** — session/daily ranges, SSL/BSL liquidity sweeps with rejection, displacement, BOS/CHOCH structure shift, Fair Value Gaps, order blocks, premium/discount zones
- **TBS breakout scoring** — candle strength, volume proxy, momentum, higher-timeframe trend; rejects false breakouts
- **0–100 confidence score** with configurable minimum (default 75)
- **Adaptive volatility engine** — continuous ATR, volatility regimes (LOW/NORMAL/ELEVATED/HIGH), RSI, momentum, dynamic SL/TP widening
- **Automatic SL/TP** — swing-based + ATR-based; TP1/TP2/TP3 partial closes, break-even after TP1, ATR trailing stop
- **Risk management** — fixed lot / percent risk / fixed dollar; conservative/balanced/aggressive profiles; daily loss limit, profit target lock, max daily trades, max consecutive losses, equity/drawdown protection
- **Small account mode** — enforces min lot, min stop distance, free margin, contract size; never martingale/grid/revenge
- **Multi-timeframe analysis** — scalping (M1/M5/M15), intraday (M5/M15/H1), swing (H1/H4/D1), auto (adapts to session)
- **Smart no-trade filters** — spread, slippage, choppiness, extreme ATR, poor RR, off-hours, daily limits
- **News filter** — OFF / Low / High / Major (configurable)
- **Broker-aware execution** — bid/ask, min/max lot, lot step, tick size/value, contract size, margin
- **Backtesting** with CRT-only / TBS-only / CRT+TBS comparison, equity curve, profit factor, max drawdown
- **Performance stats & adaptive insights** (per-asset win rates, best/worst setups, recommendations within safety limits)
- **Realistic paper trading** (spread crossing, slippage, commission) + broker adapter framework for MT4/MT5/cTrader/Binance
- **Live mode safety gate** — requires 50+ demo trades at ≥55% win rate and ≤5% max DD, plus explicit risk acknowledgment, before enabling live credentials

## Files

```
index.html              Mobile-first SPA
manifest.json           PWA manifest (install to home screen)
css/styles.css          Dark professional mobile theme
js/
  assetProfiles.js      Per-asset-class default parameters
  assetDetector.js      Symbol normalization + classification
  dataFeed.js           Multi-timeframe simulated price engine
  marketStructure.js    Swings, BOS/CHOCH, FVG, order blocks, sweeps
  volatilityEngine.js   ATR, RSI, momentum, regime detection
  strategy.js           CRT+TBS scoring and entry/exit zones
  riskManager.js        Position sizing, limits, equity protection
  executionEngine.js    Open/manage/close trades, costs, slippage
  brokerAdapters.js     MT4/MT5/cTrader/Binance adapter interface
  brokerUI.js           Live-gating & risk acknowledgment
  notifications.js      Toast alerts + modals
  statistics.js         Per-asset performance and insights
  backtest.js           Historical simulation
  charts.js             Canvas price + equity charts
  ui.js                 Dashboard rendering
  app.js                Bootstrap + main tick loop
```

## Run locally

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Deploying to GitHub Pages

Push this repo to GitHub and enable Pages on the `main` branch (root folder). The `.nojekyll` file is included so all `_`-prefixed files and folders serve correctly.

## Safety

Capital preservation first. No martingale, no unlimited grid, no revenge trading, no loss doubling. All optimization recommendations stay inside user-defined safety limits. Read the full risk disclosure inside the app before attempting any live connection.

## Disclaimer

This is educational/research software, not financial advice. All trading carries substantial risk of loss. You are fully responsible for any use you make of it.
