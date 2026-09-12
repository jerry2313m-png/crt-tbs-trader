# CRT+TBS Trading Platform — Architecture

```
┌─────────────── mobile/            PWA (this folder)
│  index.html, css/, js/           Mobile-first React-like vanilla JS
│                                  Runs in browser / as installed PWA
│
│  Talks to backend over HTTPS + WebSocket (WSS)
│  NEVER holds broker credentials (inputs -> POST /api/connections; stored encrypted server-side)
│
├── backend/server.py               Flask + Flask-SocketIO
│   /api/auth, /api/brokers, /api/positions
│   /api/orders, /api/control, /api/health
│   WebSocket: /ws/ticks, /ws/positions, /ws/audit, /ws/health
│
├── strategy/                       CRT+TBS engine (pure logic, NO broker code)
│   market_structure.py            Swings, BOS/CHOCH, FVG, OB, sweeps
│   crt.py                          CRT range / liquidity / entry zones
│   tbs.py                          Breakout confidence scoring
│   volatility.py                   ATR, RSI, momentum, regimes
│   confidence.py                   0-100 scoring
│
├── risk/manager.py                 Centralised risk — can_open_trade() is the only gate
│
├── brokers/base.py                 BrokerAdapter abstract base class
│   brokers/mt5/                   MT5 bridge client (talks to mt5_bridge.py)
│   brokers/ctrader/               cTrader Open API
│   brokers/binance/               Binance (spot + USD-M futures via ccxt)
│   brokers/coinbase/              Coinbase Advanced Trade (ccxt)
│
├── database/schema.sql             PostgreSQL schema
│   Tables: users, broker_connections, asset_profiles, trading_settings,
│           signals, orders, positions, trade_results, risk_events,
│           system_events, performance_statistics
│   Credentials stored encrypted (Fernet AES-256-GCM) in credentials_enc.
│
├── websocket/                      Ticks, order updates, audit streaming
│
├── tests/                          pytest unit + integration
│
├── docker-compose.yml              Postgres + Redis + backend; one-command deploy
├── Dockerfile
├── .env.example                    All env vars documented
└── requirements.txt                Python dependencies
```

## Key Principles

1. **One strategy engine.** `strategy/` imports zero broker modules. It works purely from market-data arrays.
2. **Every broker implements `BrokerAdapter`.** The strategy never sees broker-specific symbol names or order structures.
3. **Risk is the final gate.** Before any order is sent, `risk.can_open_trade()` must pass — emergency stops, pauses, daily/weekly limits, drawdown, margin, exposure, duplicate signals, stale data, stops_level, volume rules.
4. **No credentials in frontend.** The mobile app posts them to backend over HTTPS, backend encrypts at rest and only decrypts inside the broker adapter at call time.
5. **Fail-safe.** If any subsystem is RED (broker disconnected, stale data, DB error), new orders STOP. No retries without idempotency keys.
6. **No martingale.** Lot sizing is deterministic from risk % / distance-to-SL / contract specs; previous losses never increase size.

## Trading Flow

```
Tick (websocket/polling)
   └─► strategy.analyze(sym, candles, profile)
          ├─ confidence < min_score  → no trade
          ├─ no-trade filters (spread, session, news)
          └─ candidate signal
                └─► risk.can_open_trade(signal)
                       ├─ blocked → log + notify
                       └─ approved
                              ├─ position_size (broker spec aware)
                              ├─ order preflight (connection, freshness, margin, volume, stops distance, duplicate signal id)
                              └─ broker.place_market_order(...)
                                     ├─ reject  → log + notify
                                     └─ fill    → register position, start TP/SL/BE/trailing management
```

## Deployment

```bash
cp .env.example .env
# edit .env with real secrets
docker compose up -d --build
```

Then open https://your-server/ (or http://localhost:8080 locally).
