# Deploy to GitHub Pages

## Option A — One command (recommended)

Requires [GitHub CLI (`gh`)](https://cli.github.com/) installed and authenticated:

```bash
cd /path/to/unzipped/project
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. Create a public repo named `crt-tbs-trader` under your GitHub account
2. Push this code
3. Enable GitHub Pages on the `main` branch
4. Print your live URL (`https://YOUR_USER.github.io/crt-tbs-trader/`)

You can override the repo name / visibility by editing `deploy.sh`.

## Option B — Manual (no CLI needed)

```bash
# 1. Unzip and enter the project
unzip crt-tbs-trader.zip -d crt-tbs-trader
cd crt-tbs-trader

# 2. Initialize git (already done, but if not)
git init -b main
git add -A
git commit -m "CRT+TBS Adaptive Trader"

# 3. Create a new repo at https://github.com/new named "crt-tbs-trader" (public)
#    Do NOT check "Initialize with README".

# 4. Push
git remote add origin https://github.com/YOUR_USERNAME/crt-tbs-trader.git
git push -u origin main

# 5. Enable GitHub Pages:
#    Go to repo → Settings → Pages
#    Source: "Deploy from a branch"
#    Branch: main, /(root), Save
#    Wait ~1 minute — your app is live at https://YOUR_USERNAME.github.io/crt-tbs-trader/
```

## Install on phone (PWA)

1. Open the GitHub Pages URL in **Safari** (iOS) or **Chrome** (Android)
2. Tap the share button → **"Add to Home Screen"** (iOS) / menu → **"Install app"** (Android)
3. It launches full-screen as a standalone mobile app

## To go live later (with a real broker)

The app ships with broker adapter stubs for MT4, MT5, cTrader, and Binance. To connect a live account:

1. Stand up a bridge for your broker (e.g. a local MT4/MT5 REST API EA, or cTrader Open API WebSocket)
2. Fill in the broker endpoint + credentials in **Settings → Broker Connection**
3. Pass the demo-performance gate (50+ demo trades, ≥55% WR, ≤5% max DD)
4. Tap **Connect Broker** — only when the adapter confirms a successful connection will the connection dot turn red (LIVE) and orders route to the real broker.

**Never trade live with funds you cannot afford to lose.**
