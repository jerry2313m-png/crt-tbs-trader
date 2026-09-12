# ============================================================
# MetaTrader 5 Local Bridge for CRT+TBS Trader
# ============================================================
# Run this on the SAME PC where MetaTrader 5 is installed & logged in.
# Then open http://localhost:8080 in your browser (or use the Settings
# panel in the GitHub Pages app to point to http://localhost:8080/api).
#
# INSTALL (Windows PowerShell / terminal):
#   pip install MetaTrader5 flask flask-cors
#
# RUN:
#   python mt5_bridge.py
#
# The bridge serves the web app AND exposes REST API endpoints.
# Open http://localhost:8080 — the app will automatically connect to MT5.
# ============================================================

import os
import sys
import json
import time
import threading
from datetime import datetime
from pathlib import Path

try:
    import MetaTrader5 as mt5
except ImportError:
    print("ERROR: MetaTrader5 package not installed. Run:")
    print("    pip install MetaTrader5")
    sys.exit(1)

try:
    from flask import Flask, request, jsonify, send_from_directory, Response
    from flask_cors import CORS
except ImportError:
    print("ERROR: Flask / flask-cors not installed. Run:")
    print("    pip install flask flask-cors")
    sys.exit(1)

# ---------- Configuration ----------
HOST = "0.0.0.0"
PORT = int(os.environ.get("MT5_BRIDGE_PORT", "8080"))
APP_DIR = Path(__file__).parent  # serve static files from same directory

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# ---------- State ----------
state = {
    "connected": False,
    "credentials": {},
    "last_error": None,
    "tick_cache": {},
}

# ---------- Helpers ----------
ORDER_TYPE_BUY = 0
ORDER_TYPE_SELL = 1
ORDER_TYPE_BUY_LIMIT = 2
ORDER_TYPE_SELL_LIMIT = 3
ORDER_TYPE_BUY_STOP = 4
ORDER_TYPE_SELL_STOP = 5
ORDER_TIME_GTC = 1
ORDER_FILLING_FOK = 0
ORDER_FILLING_IOC = 1
ORDER_FILLING_RETURN = 2


def mt5_result_to_dict(res):
    if res is None:
        return None
    if hasattr(res, "_asdict"):
        d = res._asdict()
        # datetime objects -> ISO strings
        for k, v in list(d.items()):
            if isinstance(v, datetime):
                d[k] = v.isoformat()
        return d
    return dict(res)


def get_filling_type(symbol):
    """Try all filling modes and return what the broker accepts."""
    # Try FOK -> IOC -> RETURN
    for filling in [ORDER_FILLING_FOK, ORDER_FILLING_IOC, ORDER_FILLING_RETURN]:
        return filling
    return ORDER_FILLING_FOK


def check(result, action="action"):
    if result is None:
        err = mt5.last_error()
        return {"ok": False, "error": f"{action} failed: {err}", "last_error": err}
    if hasattr(result, "retcode") and result.retcode != 10009:
        return {"ok": False, "error": f"{action} retcode={result.retcode} comment={getattr(result,'comment','')}", "retcode": result.retcode}
    return {"ok": True, "result": mt5_result_to_dict(result)}


# ---------- API endpoints ----------
@app.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "mt5_initialized": mt5.initialize() if not state["connected"] else True,
        "connected": state["connected"],
        "version": "1.0.0",
    })


@app.route("/api/connect", methods=["POST"])
def connect():
    """
    Body (JSON):
      { login: int, password: str, server: str, path?: str }
    If all fields are missing, attempts to connect to the already-running MT5 terminal.
    """
    data = request.get_json(silent=True) or {}

    # Shutdown existing connection
    if state["connected"]:
        mt5.shutdown()
        state["connected"] = False

    kwargs = {}
    if data.get("login"):
        kwargs["login"] = int(data["login"])
    if data.get("password"):
        kwargs["password"] = data["password"]
    if data.get("server"):
        kwargs["server"] = data["server"]
    if data.get("path"):
        kwargs["path"] = data["path"]

    ok = mt5.initialize(**kwargs) if kwargs else mt5.initialize()
    if not ok:
        err = mt5.last_error()
        state["last_error"] = str(err)
        return jsonify({"ok": False, "error": f"initialize() failed: {err}"}), 400

    # Verify by fetching account info
    acc = mt5.account_info()
    if acc is None:
        err = mt5.last_error()
        mt5.shutdown()
        return jsonify({"ok": False, "error": f"account_info() failed (wrong login/password/server?): {err}"}), 400

    state["connected"] = True
    state["credentials"] = data

    acc_dict = mt5_result_to_dict(acc)
    return jsonify({"ok": True, "account": acc_dict})


@app.route("/api/disconnect", methods=["POST"])
def disconnect():
    mt5.shutdown()
    state["connected"] = False
    return jsonify({"ok": True})


@app.route("/api/account")
def account():
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    acc = mt5.account_info()
    if acc is None:
        return jsonify({"ok": False, "error": str(mt5.last_error())}), 500
    return jsonify({"ok": True, "account": mt5_result_to_dict(acc)})


@app.route("/api/symbols")
def symbols():
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    all_syms = mt5.symbols_get()
    visible = [s for s in (all_syms or []) if s.visible]
    out = []
    for s in visible:
        out.append({
            "name": s.name,
            "digits": s.digits,
            "point": s.point,
            "trade_contract_size": s.trade_contract_size,
            "volume_min": s.volume_min,
            "volume_max": s.volume_max,
            "volume_step": s.volume_step,
            "spread": s.spread,
            "stops_level": s.trade_stops_level,
            "currency_base": s.currency_base,
            "currency_profit": s.currency_profit,
            "description": s.description,
        })
    return jsonify({"ok": True, "count": len(out), "symbols": out})


@app.route("/api/symbol/<sym>")
def symbol_info(sym):
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    info = mt5.symbol_info(sym)
    if info is None:
        return jsonify({"ok": False, "error": f"Symbol {sym} not found"}), 404
    # Make sure symbol is visible in MarketWatch
    if not info.visible:
        mt5.symbol_select(sym, True)
        info = mt5.symbol_info(sym)
    d = mt5_result_to_dict(info)
    # Add latest tick
    tick = mt5.symbol_info_tick(sym)
    if tick:
        d["tick"] = mt5_result_to_dict(tick)
    return jsonify({"ok": True, "info": d})


@app.route("/api/tick/<sym>")
def tick(sym):
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    t = mt5.symbol_info_tick(sym)
    if t is None:
        return jsonify({"ok": False, "error": str(mt5.last_error())}), 404
    return jsonify({"ok": True, "tick": mt5_result_to_dict(t)})


@app.route("/api/candles/<sym>/<tf>")
def candles(sym, tf):
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    count = int(request.args.get("count", 200))
    tf_map = {
        "M1": mt5.TIMEFRAME_M1, "M5": mt5.TIMEFRAME_M5, "M15": mt5.TIMEFRAME_M15,
        "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1, "H4": mt5.TIMEFRAME_H4,
        "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1,
    }
    tf_val = tf_map.get(tf.upper())
    if tf_val is None:
        return jsonify({"ok": False, "error": f"Unsupported timeframe {tf}"}), 400
    rates = mt5.copy_rates_from_pos(sym, tf_val, 0, count)
    if rates is None:
        return jsonify({"ok": False, "error": str(mt5.last_error())}), 500
    out = []
    for r in rates:
        out.append({
            "time": int(r[0]),
            "open": float(r[1]),
            "high": float(r[2]),
            "low": float(r[3]),
            "close": float(r[4]),
            "volume": float(r[5]),
            "spread": int(r[6]) if len(r) > 6 else 0,
        })
    return jsonify({"ok": True, "count": len(out), "candles": out})


@app.route("/api/order", methods=["POST"])
def order():
    """
    Place a market order.
    Body: { symbol, side: "buy"|"sell", lot, sl?, tp?, comment?, magic? }
    """
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400

    data = request.get_json(force=True)
    sym = data["symbol"]
    side = data["side"].lower()
    lot = float(data["lot"])
    sl = float(data["sl"]) if data.get("sl") else 0.0
    tp = float(data["tp"]) if data.get("tp") else 0.0
    comment = data.get("comment", "CRT+TBS")
    magic = int(data.get("magic", 27042025))

    # Ensure symbol selected & get tick
    mt5.symbol_select(sym, True)
    tick = mt5.symbol_info_tick(sym)
    if tick is None:
        return jsonify({"ok": False, "error": f"Cannot get tick for {sym}: {mt5.last_error()}"}), 500
    info = mt5.symbol_info(sym)
    if info is None:
        return jsonify({"ok": False, "error": f"Cannot get symbol info for {sym}"}), 500

    # Validate SL/TP distance against stops_level
    stops_level = info.trade_stops_level * info.point
    price = tick.ask if side == "buy" else tick.bid

    if sl > 0:
        if side == "buy" and sl >= price - stops_level:
            return jsonify({"ok": False, "error": f"SL too close (min distance {stops_level:.{info.digits}f})"}), 400
        if side == "sell" and sl <= price + stops_level:
            return jsonify({"ok": False, "error": f"SL too close (min distance {stops_level:.{info.digits}f})"}), 400
    if tp > 0:
        if side == "buy" and tp <= price + stops_level:
            return jsonify({"ok": False, "error": f"TP too close"}), 400
        if side == "sell" and tp >= price - stops_level:
            return jsonify({"ok": False, "error": f"TP too close"}), 400

    # Validate lot size
    lot = max(info.volume_min, min(info.volume_max, lot))
    # Round to volume_step
    step = info.volume_step
    lot = round(lot - (lot % step), 2) if step > 0 else lot

    filling = get_filling_type(sym)
    request_type = ORDER_TYPE_BUY if side == "buy" else ORDER_TYPE_SELL

    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": sym,
        "volume": lot,
        "type": request_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": 20,  # max slippage in points
        "magic": magic,
        "comment": comment[:31],  # MT5 comment limit
        "type_time": ORDER_TIME_GTC,
        "type_filling": filling,
    }

    # Try with FOK first; if fails, retry with IOC and RETURN
    result = None
    last_err = None
    for fill_mode in [ORDER_FILLING_FOK, ORDER_FILLING_IOC, ORDER_FILLING_RETURN]:
        req["type_filling"] = fill_mode
        result = mt5.order_send(req)
        if result is not None and result.retcode == 10009:
            break
        last_err = mt5.last_error() if result is None else getattr(result, "comment", "")

    if result is None or result.retcode != 10009:
        return jsonify({
            "ok": False,
            "error": f"order_send failed: retcode={getattr(result,'retcode','N/A')} comment={getattr(result,'comment','')} last_err={last_err}",
            "request": req,
        }), 500

    return jsonify({
        "ok": True,
        "order": mt5_result_to_dict(result),
        "ticket": result.order,
        "open_price": result.price,
        "volume": lot,
    })


@app.route("/api/close", methods=["POST"])
def close():
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    data = request.get_json(force=True)
    ticket = int(data["ticket"])
    # Get position
    pos = mt5.positions_get(ticket=ticket)
    if not pos:
        return jsonify({"ok": False, "error": f"Position {ticket} not found"}), 404
    pos = pos[0]

    mt5.symbol_select(pos.symbol, True)
    tick = mt5.symbol_info_tick(pos.symbol)
    info = mt5.symbol_info(pos.symbol)
    filling = get_filling_type(pos.symbol)

    # Opposite side
    close_type = ORDER_TYPE_SELL if pos.type == ORDER_TYPE_BUY else ORDER_TYPE_BUY
    price = tick.bid if close_type == ORDER_TYPE_BUY else tick.ask

    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": pos.symbol,
        "volume": pos.volume,
        "type": close_type,
        "position": ticket,
        "price": price,
        "deviation": 30,
        "magic": 27042025,
        "comment": "CRT+TBS close",
        "type_time": ORDER_TIME_GTC,
        "type_filling": filling,
    }

    result = None
    for fill_mode in [ORDER_FILLING_FOK, ORDER_FILLING_IOC, ORDER_FILLING_RETURN]:
        req["type_filling"] = fill_mode
        result = mt5.order_send(req)
        if result is not None and result.retcode == 10009:
            break

    if result is None or result.retcode != 10009:
        return jsonify({
            "ok": False,
            "error": f"close failed: retcode={getattr(result,'retcode','N/A')} comment={getattr(result,'comment','')}",
        }), 500

    return jsonify({"ok": True, "result": mt5_result_to_dict(result)})


@app.route("/api/modify", methods=["POST"])
def modify():
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    data = request.get_json(force=True)
    ticket = int(data["ticket"])
    sl = float(data.get("sl", 0))
    tp = float(data.get("tp", 0))

    pos = mt5.positions_get(ticket=ticket)
    if not pos:
        return jsonify({"ok": False, "error": f"Position {ticket} not found"}), 404
    pos = pos[0]

    req = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": pos.symbol,
        "position": ticket,
        "sl": sl,
        "tp": tp,
    }
    result = mt5.order_send(req)
    chk = check(result, "modify SL/TP")
    return jsonify(chk)


@app.route("/api/positions")
def positions():
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    positions = mt5.positions_get()
    out = []
    for p in positions or []:
        d = mt5_result_to_dict(p)
        # Add current PnL update
        tick = mt5.symbol_info_tick(p.symbol)
        d["current_bid"] = tick.bid if tick else None
        d["current_ask"] = tick.ask if tick else None
        out.append(d)
    return jsonify({"ok": True, "count": len(out), "positions": out})


@app.route("/api/history")
def history():
    if not state["connected"]:
        return jsonify({"ok": False, "error": "Not connected"}), 400
    from datetime import timedelta
    days = int(request.args.get("days", 7))
    from_date = datetime.now() - timedelta(days=days)
    to_date = datetime.now()
    deals = mt5.history_deals_get(from_date, to_date)
    out = [mt5_result_to_dict(d) for d in (deals or [])]
    return jsonify({"ok": True, "count": len(out), "deals": out})


# ---------- Serve static web app ----------
@app.route("/")
def index():
    return send_from_directory(APP_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    # Special case: don't serve mt5_bridge.py or deploy artifacts
    if path.endswith(".py") or path.endswith(".zip") or path == "DEPLOY.md":
        return ("Not found", 404)
    if (APP_DIR / path).exists():
        return send_from_directory(APP_DIR, path)
    return ("Not found", 404)


# ---------- Auto-refresh tick cache thread ----------
def tick_poller():
    while True:
        if state["connected"]:
            try:
                positions = mt5.positions_get()
                for p in positions or []:
                    mt5.symbol_info_tick(p.symbol)
            except Exception:
                pass
        time.sleep(1)


# ---------- Main ----------
def main():
    print("=" * 60)
    print(" CRT+TBS Trader — MetaTrader 5 Bridge")
    print("=" * 60)
    print(f"  Static app directory: {APP_DIR}")
    print(f"  Listening on: http://localhost:{PORT}")
    print("")
    print("  Open this URL in your browser once MT5 is running")
    print("  and enter login/password/server in Settings → Broker.")
    print("")

    # Start tick polling thread
    t = threading.Thread(target=tick_poller, daemon=True)
    t.start()

    # Disable noisy Flask logs
    import logging
    log = logging.getLogger("werkzeug")
    log.setLevel(logging.WARNING)

    app.run(host=HOST, port=PORT, threaded=True)


if __name__ == "__main__":
    main()
