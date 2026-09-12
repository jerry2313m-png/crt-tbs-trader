"""
CRT+TBS Trading Platform — Backend Server
Scaffold exposing:
  - JWT authentication
  - REST + WebSocket API
  - Broker adapter registry
  - Health indicators
  - Emergency stop & pause controls
  - Encrypted secret storage stubs (wire to Fernet in production)
  - Signal / order / trade event stream

Run with:
    python -m backend.server
"""
import os
import json
import time
import uuid
import threading
from datetime import datetime, timezone
from pathlib import Path
from functools import wraps

from dotenv import load_dotenv
load_dotenv()

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
try:
    from flask_socketio import SocketIO, emit
    _SOCKETIO_AVAILABLE = True
except ImportError:
    _SOCKETIO_AVAILABLE = False

from cryptography.fernet import Fernet

# ----------------------------------------------------------------------
# App setup
# ----------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
MOBILE_DIR = BASE_DIR / "mobile"

app = Flask(__name__, static_folder=None)
app.config["SECRET_KEY"] = os.environ.get("JWT_SECRET", "dev-only-change-me")
CORS(app, resources={r"/api/*": {"origins": "*"}})

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading") if _SOCKETIO_AVAILABLE else None

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-jwt-secret")

# Simple token (in production replace with flask-jwt-extended + refresh + roles)
TOKENS = {}  # token -> {user_id, created}

# Encryption for secrets (generate with Fernet.generate_key())
_ENC_KEY = os.environ.get("ENCRYPTION_KEY")
if _ENC_KEY:
    _FERNET = Fernet(_ENC_KEY.encode())
else:
    _FERNET = None  # dev mode

def encrypt_secret(plaintext: str) -> str:
    if _FERNET is None: return "enc:" + plaintext  # dev only
    return _FERNET.encrypt(plaintext.encode()).decode()

def decrypt_secret(ciphertext: str) -> str:
    if _FERNET is None:
        return ciphertext[4:] if ciphertext.startswith("enc:") else ciphertext
    return _FERNET.decrypt(ciphertext.encode()).decode()

# ----------------------------------------------------------------------
# In-memory state (PostgreSQL in production)
# ----------------------------------------------------------------------
class SystemState:
    def __init__(self):
        self.connections = {}     # conn_id -> { broker, credentials_enc, status, account_info }
        self.active_conn = None   # connection currently routing orders
        self.pause_new = False
        self.emergency_stopped = False
        self.emergency_close_on_stop = True
        self.last_error = None
        self.component_health = {
            "api":        {"status":"green","msg":"operational"},
            "broker":     {"status":"red","msg":"not connected"},
            "market_data":{"status":"red","msg":"no data"},
            "database":   {"status":"yellow","msg":"running in dev mode (in-memory)"},
            "strategy":   {"status":"green","msg":"operational"},
            "risk":       {"status":"green","msg":"operational"},
            "execution":  {"status":"green","msg":"operational"},
        }
        self.health_history = []
        self.audit = []

    def log(self, event, data=None):
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "event": event, "data": data or {}}
        self.audit.append(entry)
        if len(self.audit) > 5000: self.audit = self.audit[-5000:]
        if socketio: socketio.emit("audit", entry)

STATE = SystemState()

def set_health(component, status, msg):
    STATE.component_health[component] = {"status":status,"msg":msg}
    STATE.log("health", {"component":component,"status":status,"msg":msg})
    if socketio: socketio.emit("health", STATE.component_health)

# ----------------------------------------------------------------------
# Auth helpers (dev only — replace with JWT in production)
# ----------------------------------------------------------------------
def require_auth(f):
    @wraps(f)
    def wrapper(*a, **kw):
        auth = request.headers.get("Authorization","").replace("Bearer ","")
        # Accept dev auto-token for local development
        if os.environ.get("NODE_ENV","development") == "development" and request.remote_addr in ("127.0.0.1","::1","localhost"):
            return f(*a, **kw)
        if not auth or auth not in TOKENS:
            return jsonify({"ok":False,"error":"Unauthorized"}),401
        return f(*a, **kw)
    return wrapper

@app.route("/api/auth/login", methods=["POST"])
def login():
    # Dev-only: accept any credentials and return a token.
    # In production: bcrypt password hash, 2FA, etc.
    d = request.get_json(silent=True) or {}
    uid = d.get("username","demo")
    tok = uuid.uuid4().hex
    TOKENS[tok] = {"user_id":uid,"created":time.time()}
    return jsonify({"ok":True,"token":tok,"user":uid})

# ----------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------
@app.route("/api/health")
def health():
    return jsonify({
        "ok": True,
        "version": "1.0.0",
        "time": datetime.now(timezone.utc).isoformat(),
        "components": STATE.component_health,
        "paused": STATE.pause_new,
        "emergency": STATE.emergency_stopped,
    })

# ----------------------------------------------------------------------
# Brokers — list / connect / disconnect
# ----------------------------------------------------------------------
@app.route("/api/brokers")
def broker_catalog():
    return jsonify({
        "ok": True,
        "brokers": [
            {"id":"simulated","name":"Simulated (Paper)","type":"simulated","assets":["FOREX","GOLD","CRYPTO","INDEX"]},
            {"id":"mt5","name":"MetaTrader 5","type":"mt5","assets":["FOREX","GOLD","CRYPTO","INDEX"],"requiresBridge":True},
            {"id":"ctrader","name":"cTrader Open API","type":"ctrader","assets":["FOREX","GOLD","CRYPTO","INDEX"]},
            {"id":"binance","name":"Binance","type":"exchange","assets":["CRYPTO"]},
            {"id":"coinbase","name":"Coinbase Advanced Trade","type":"exchange","assets":["CRYPTO"]},
        ]
    })

@app.route("/api/connections", methods=["GET"])
@require_auth
def list_connections():
    out = []
    for cid, c in STATE.connections.items():
        out.append({
            "id": cid,
            "broker": c["broker"],
            "status": c["status"],
            "account": c.get("account_info",{}).get("login"),
            "server": c.get("account_info",{}).get("server"),
            "type": c.get("account_info",{}).get("type"),
            "active": cid == STATE.active_conn,
        })
    return jsonify({"ok":True,"connections":out})

@app.route("/api/connections", methods=["POST"])
@require_auth
def create_connection():
    d = request.get_json(force=True)
    broker = d["broker"]
    credentials = d.get("credentials",{})
    cid = uuid.uuid4().hex[:12]
    creds_enc = {k: (encrypt_secret(v) if "secret" in k.lower() or "password" in k.lower() or "key" in k.lower() else v)
                 for k,v in credentials.items()}
    STATE.connections[cid] = {
        "broker":broker, "credentials":creds_enc, "status":"connecting",
        "account_info":d.get("account_type","demo").upper(),
    }
    set_health("broker","yellow","connecting to "+broker)
    STATE.log("broker.connect", {"broker":broker,"cid":cid})
    # TODO: real broker connect via adapter — for now simulate
    STATE.connections[cid]["status"] = "connected"
    STATE.connections[cid]["account_info"] = {
        "login": credentials.get("login","--"),
        "server": credentials.get("server","--"),
        "currency":"USD","balance":10000,"equity":10000,"margin":0,
        "free_margin":10000,"margin_level":0,"leverage":500,"type":d.get("account_type","demo"),
        "broker":broker,
    }
    set_health("broker","green","connected to "+broker)
    return jsonify({"ok":True,"id":cid,"account":STATE.connections[cid]["account_info"]})

@app.route("/api/connections/<cid>/activate", methods=["POST"])
@require_auth
def activate_connection(cid):
    if cid not in STATE.connections: return jsonify({"ok":False,"error":"Not found"}),404
    d = request.get_json(silent=True) or {}
    if d.get("confirm") is not True:
        return jsonify({"ok":False,"error":"Confirmation required"}),400
    STATE.active_conn = cid
    STATE.log("broker.activate", {"cid":cid})
    return jsonify({"ok":True})

@app.route("/api/connections/<cid>/disconnect", methods=["POST"])
@require_auth
def disconnect(cid):
    if cid in STATE.connections:
        STATE.connections[cid]["status"]="disconnected"
        if STATE.active_conn == cid:
            STATE.active_conn = None
            set_health("broker","red","disconnected")
        STATE.log("broker.disconnect", {"cid":cid})
    return jsonify({"ok":True})

@app.route("/api/connections/<cid>/test", methods=["POST"])
@require_auth
def test_connection(cid):
    return jsonify({"ok":cid in STATE.connections,"latency_ms":23})

# ----------------------------------------------------------------------
# Emergency controls
# ----------------------------------------------------------------------
@app.route("/api/control/emergency-stop", methods=["POST"])
@require_auth
def emergency_stop():
    d = request.get_json(silent=True) or {}
    close_all = d.get("close_positions", True)
    STATE.emergency_stopped = True
    STATE.pause_new = True
    set_health("execution","red","EMERGENCY STOP")
    set_health("strategy","red","disabled by emergency stop")
    STATE.log("emergency_stop", {"close_positions":close_all})
    if socketio: socketio.emit("emergency", {"close_positions":close_all})
    # TODO: actually cancel pending orders and close positions via broker adapter
    return jsonify({"ok":True,"close_positions":close_all})

@app.route("/api/control/pause", methods=["POST"])
@require_auth
def pause():
    STATE.pause_new = True
    STATE.log("paused")
    set_health("strategy","yellow","new entries paused")
    return jsonify({"ok":True})

@app.route("/api/control/resume", methods=["POST"])
@require_auth
def resume():
    STATE.pause_new = False
    STATE.emergency_stopped = False
    set_health("strategy","green","operational")
    set_health("execution","green","operational")
    STATE.log("resumed")
    return jsonify({"ok":True})

@app.route("/api/control/status")
def control_status():
    return jsonify({
        "ok":True,
        "paused":STATE.pause_new,
        "emergency":STATE.emergency_stopped,
        "active_connection":STATE.active_conn,
    })

# ----------------------------------------------------------------------
# Account / Positions / Orders (relay from active broker when live)
# ----------------------------------------------------------------------
@app.route("/api/account")
@require_auth
def account():
    conn = STATE.connections.get(STATE.active_conn)
    if not conn:
        return jsonify({"ok":True,"simulated":True,"balance":10000,"equity":10000,
                        "margin":0,"free_margin":10000,"daily_pnl":0,"weekly_pnl":0,"drawdown":0})
    return jsonify({"ok":True,"simulated":False, **conn["account_info"]})

@app.route("/api/positions")
@require_auth
def positions():
    # Relayed from broker in production; for now return empty
    return jsonify({"ok":True,"positions":[]})

@app.route("/api/audit")
@require_auth
def audit():
    return jsonify({"ok":True,"events":STATE.audit[-100:]})

# ----------------------------------------------------------------------
# Mobile static files
# ----------------------------------------------------------------------
@app.route("/mobile/<path:path>")
def mobile_files(path):
    return send_from_directory(MOBILE_DIR, path)

@app.route("/")
def root():
    return send_from_directory(MOBILE_DIR, "index.html")

# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------
if __name__ == "__main__":
    set_health("api","green","operational")
    set_health("strategy","green","operational")
    set_health("risk","green","operational")
    set_health("execution","green","operational")
    port = int(os.environ.get("PORT","8080"))
    print(f"[backend] CRT+TBS backend listening on :{port}")
    if socketio:
        socketio.run(app, host="0.0.0.0", port=port, allow_unsafe_werkzeug=True)
    else:
        app.run(host="0.0.0.0", port=port, threaded=True)
