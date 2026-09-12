#!/usr/bin/env bash
# Quick-start for macOS/Linux (MetaTrader 5 runs on Linux via Wine/Crossover)
set -e
echo "=============================================="
echo " CRT+TBS Trader — MT5 Bridge"
echo "=============================================="
if ! command -v python3 >/dev/null; then
  echo "Python 3 not found. Install Python 3 and try again."; exit 1;
fi
echo "Installing dependencies..."
python3 -m pip install --quiet --upgrade MetaTrader5 flask flask-cors || {
  echo "Note: MetaTrader5 Python package works on Windows natively, on Linux via Wine."
}
echo ""
echo "Starting bridge on http://localhost:8080"
python3 mt5_bridge.py
