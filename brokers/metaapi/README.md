# MetaApi MT4/MT5 Adapter

This adapter talks to **MetaApi.cloud** — a paid cloud service that connects to MT4/MT5 brokers (Exness, IC Markets, Pepperstone, FXCM, and most other MT4/MT5 brokers) over the MetaQuotes protocol and exposes REST + WebSocket APIs. It is the **primary** real-money integration path for this platform because:

- You do not need to keep a Windows VPS running 24/7
- It handles MT5 connection management, reconnects, and rate limits
- It works with Exness demo **and** live accounts (you must have a funded MetaApi subscription for live trading)
- Symbol normalization is done dynamically by reading the live symbol list at connect time (so `EURUSDm`, `XAUUSDm`, `EURUSD.a` etc. are handled without hard-coding)

## Setup (Exness example)

1. **Create an Exness demo (or live) MT5 account** at https://exness.com — note the login, password, and server (e.g. `Exness-MT5Trial9` for demo, `Exness-MT5Real8`/`Real25` for live — exact server name is shown in MT5 → File → Open an Account).
2. **Sign up at MetaApi.cloud** (https://app.metaapi.cloud) and generate an API token. A free-tier token is enough for development/testing but is rate-limited.
3. In the app, go to **Settings → Broker Connection**, select **"MetaTrader via MetaApi.cloud"**, and fill in:
   - Backend URL: the URL where you deployed the backend (default `http://localhost:8080` when running locally)
   - MetaApi token
   - MT5 login, password, server
   - Platform: MT5
   - Account Type: **demo** first (always!)
4. Click **Test Connection** — this triggers the real MetaApi create/deploy/connect flow. It will show "connected" only after the MetaApi gateway reaches CONNECTED state (typically 30–90 seconds). It will return the real error if your login/password/server is wrong.
5. Click **Connect Broker**, then **ENABLE LIVE TRADING** (note: "LIVE" in the app only activates after you pass the demo gate and confirm the account summary).

## Known limitations (do NOT ignore)

- MetaApi is not free. Check pricing at https://metaapi.cloud/#pricing
- Free tier is for development only — trades on free tier may be rate-limited or delayed
- Investor password can be used to view quotes/positions but **cannot place trades**. Use your master/trading password if you want the bot to execute orders.
- Exness-specific suffixes are discovered at connect time. If your account uses raw spreads (suffix `.raw`) or pro (`.pro`) they will appear in the symbol list automatically.

## Self-hosted fallback

If you don't want to use MetaApi, run MT5 on a Windows VPS and use `brokers/mt5/mt5_bridge.py` (the bridge we already built). Select "MetaTrader 5 (self-hosted)" in the broker selector.
