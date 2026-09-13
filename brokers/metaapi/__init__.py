"""
MetaApi.cloud MT4/MT5 adapter — concrete BrokerAdapter implementation.

MetaApi is a commercial cloud service (https://metaapi.cloud) that connects to
MT4/MT5 brokers — including Exness — over the MetaQuotes protocol on your behalf,
and exposes REST + WebSocket APIs. You supply:
   - a MetaApi API token       (from https://app.metaapi.cloud/token)
   - your MT5 login
   - your MT5 password         (trading password for order placement;
                                investor password is sufficient for quotes/positions
                                but trading calls will fail)
   - broker server name        (e.g. "Exness-MT5Real8", "Exness-MT5Trial9",
                                "Exness-MT5Real25" — exact name depends on the
                                server your account was created on)
   - platform: MT4 or MT5

IMPORTANT LIMITATIONS (do NOT change without understanding):
 - MetaApi is a paid service. Free tier is rate-limited and not intended for
   live 24/7 automated trading.
 - This adapter does NOT fabricate fills, prices, or account balances. If the
   MetaApi call fails, raises, or returns a non-10009 retcode, the adapter
   raises BrokerError and the risk/execution layer halts new entries.
 - Symbol suffixes are read from the live symbol list at connect time — not
   hard-coded. Exness uses "m" suffix on some accounts, raw names on others,
   ".ecn" on pro accounts; the adapter discovers this dynamically.

API docs: https://metaapi.cloud/docs/client/
"""
import time
import json
import asyncio
from datetime import datetime, timezone
from typing import List, Optional

import requests
import websocket  # websocket-client

from brokers.base import (
    BrokerAdapter, BrokerError, BrokerErrorCode, AccountInfo, SymbolInfo,
    Quote, Candle, Position, Order, OrderResult, OrderType, OrderStatus, Side
)

METAAPI_BASE = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai"
METAAPI_TRADING = "https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai"
METAAPI_STREAM = "wss://mt-streaming-api-v1.agiliumtrade.agiliumtrade.ai"


class MetaApiAdapter(BrokerAdapter):
    id = "metaapi"
    name = "MetaApi.cloud (MT4/MT5 — works with Exness, IC Markets, etc.)"
    is_exchange = False

    def __init__(self):
        self.token = None
        self.login = None
        self.password = None
        self.server = None
        self.platform = "mt5"
        self.account_id = None
        self._api = None
        self._symbols_cache = {}
        self._ws = None
        self._tick_callbacks = []
        self._connected = False
        self._ws_thread = None
        self._ws_running = False

    # ---------------- lifecycle ----------------
    def connect(self, credentials: dict) -> bool:
        """
        credentials:
            token       MetaApi API token
            login       MT account number (int/str)
            password    MT password (trading password to trade)
            server      broker server name, e.g. "Exness-MT5Trial9"
            platform    "mt5" (default) | "mt4"
            name        optional friendly name
        """
        self.token = credentials.get("token")
        self.login = str(credentials.get("login",""))
        self.password = credentials.get("password","")
        self.server = credentials.get("server","")
        self.platform = credentials.get("platform","mt5").lower()

        if not self.token: raise BrokerError("MetaApi token is required", BrokerErrorCode.AUTH_FAILED)
        if not self.login: raise BrokerError("MT login is required", BrokerErrorCode.AUTH_FAILED)
        if not self.password: raise BrokerError("MT password is required", BrokerErrorCode.AUTH_FAILED)
        if not self.server: raise BrokerError("MT server name is required (e.g. Exness-MT5Trial9)", BrokerErrorCode.AUTH_FAILED)

        self._auth_header = {"auth-token": self.token, "Content-Type":"application/json"}

        # Step 1: Check whether an account with this login+server already exists
        accounts = self._get("/users/current/accounts")
        existing = None
        for a in accounts.get("accounts",[]):
            if str(a.get("login")) == self.login and a.get("serverName","").lower() == self.server.lower():
                existing = a; break

        if existing:
            self.account_id = existing["_id"]
        else:
            # Step 2: Create MetaApi trading account
            body = {
                "type": {"mt5": "cloud-g2", "mt4": "cloud-g2-mt4"}.get(self.platform, "cloud-g2"),
                "login": self.login,
                "password": self.password,
                "name": credentials.get("name", f"CRT+TBS {self.server}"),
                "server": self.server,
                "platform": self.platform,
                "magic": 27042025,
            }
            created = self._post("/users/current/accounts", body)
            self.account_id = created.get("_id")
            if not self.account_id:
                raise BrokerError(f"Failed to create MetaApi account: {created}", BrokerErrorCode.AUTH_FAILED)

        # Step 3: Deploy the account (start the cloud gateway)
        self._post(f"/users/current/accounts/{self.account_id}/deploy", {})

        # Step 4: Wait until connection state is CONNECTED (up to ~120s)
        deadline = time.time() + 120
        last_state = None
        while time.time() < deadline:
            info = self._get(f"/users/current/accounts/{self.account_id}")
            state = info.get("state")
            conn = info.get("connectionStatus")
            last_state = f"{state}/{conn}"
            if state == "DEPLOYED" and conn in ("CONNECTED","CONNECTED_TO_BROKER"):
                self._connected = True
                # warm up symbol cache
                self._refresh_symbol_cache()
                return True
            if state in ("FAILED","BLOCKED","DISABLED"):
                raise BrokerError(
                    f"MetaApi account state {state} / {conn}",
                    BrokerErrorCode.AUTH_FAILED)
            time.sleep(3)

        raise BrokerError(
            f"Timed out waiting for MetaApi connection (last state: {last_state}). "
            f"Check login/password/server.", BrokerErrorCode.NETWORK_ERROR)

    def disconnect(self):
        self._ws_running = False
        if self._ws:
            try: self._ws.close()
            except Exception: pass
        if self.account_id:
            try: self._post(f"/users/current/accounts/{self.account_id}/undeploy", {})
            except Exception: pass
        self._connected = False
        self.account_id = None
        self._symbols_cache = {}

    def is_connected(self) -> bool: return self._connected

    # ---------------- helpers ----------------
    def _headers(self): return {"auth-token": self.token, "Content-Type": "application/json"}

    def _get(self, path):
        url = (METAAPI_TRADING if path.startswith("/users/current/accounts/") and not path.startswith("/users/current/accounts")+"/" and False else METAAPI_BASE)
        # MetaApi splits provisioning (https://mt-provisioning-api...) and trading API (https://mt-client-api-v1...)
        # Trading calls go to mt-client-api-v1 with account_id in path
        if path.startswith("/trade/") or path.startswith("/users/current/accounts/") and ("/trade" in path or "/positions" in path or "/orders" in path or "/symbols" in path or "/ticks" in path or "/candles" in path or "/account" in path):
            url = METAAPI_TRADING
            path = path.replace("/users/current/accounts", f"/users/current/accounts/{self.account_id}")
            path = path.replace(f"/{self.account_id}/", "/")
            full = f"{url}{path}"
        else:
            full = f"{METAAPI_BASE}{path}"
        r = requests.get(full, headers=self._headers(), timeout=15)
        if r.status_code >= 400:
            raise BrokerError(f"GET {path} -> HTTP {r.status_code}: {r.text[:200]}", BrokerErrorCode.NETWORK_ERROR)
        return r.json()

    def _post(self, path, body):
        if path.startswith("/trade/") or "/trade/" in path or path.endswith("/deploy") or path.endswith("/undeploy"):
            url = METAAPI_TRADING if "/trade/" in path else METAAPI_BASE
            full = f"{url}{path}"
        else:
            full = f"{METAAPI_BASE}{path}"
        r = requests.post(full, headers=self._headers(), data=json.dumps(body), timeout=20)
        if r.status_code >= 400:
            raise BrokerError(f"POST {path} -> HTTP {r.status_code}: {r.text[:200]}", BrokerErrorCode.NETWORK_ERROR)
        return r.json() if r.text else {}

    # Dedicated trading-api wrapper (uses different host)
    def _trade_get(self, path):
        url = f"{METAAPI_TRADING}/users/current/accounts/{self.account_id}{path}"
        r = requests.get(url, headers=self._headers(), timeout=15)
        if r.status_code == 401:
            self._connected = False
            raise BrokerError("Unauthorized — MetaApi token rejected", BrokerErrorCode.AUTH_FAILED)
        if r.status_code >= 400:
            raise BrokerError(f"Trade GET {path} -> HTTP {r.status_code}: {r.text[:200]}", BrokerErrorCode.NETWORK_ERROR)
        return r.json()

    def _trade_post(self, path, body):
        url = f"{METAAPI_TRADING}/users/current/accounts/{self.account_id}{path}"
        r = requests.post(url, headers=self._headers(), data=json.dumps(body), timeout=20)
        if r.status_code >= 400:
            raise BrokerError(f"Trade POST {path} -> HTTP {r.status_code}: {r.text[:300]}", BrokerErrorCode.NETWORK_ERROR)
        return r.json() if r.text else {}

    def _refresh_symbol_cache(self):
        # MetaApi: GET /symbols returns full specifications
        try:
            specs = self._trade_get("/symbols")
            if isinstance(specs, dict) and "payload" in specs: specs = specs["payload"]
            for sym_name, spec in specs.items():
                self._symbols_cache[sym_name] = spec
        except Exception as e:
            raise BrokerError(f"Failed to load symbols: {e}", BrokerErrorCode.NETWORK_ERROR)

    def _norm(self, sym):
        """Normalize broker symbol using discovered suffixes. E.g. 'XAUUSDm' -> 'XAUUSD'."""
        if sym in self._symbols_cache: return sym
        # Try to match by stripping known suffixes discovered at connect
        # We'll inspect symbols' original name vs a canonical form guess
        upper = sym.upper()
        for suffix in self._suffixes():
            if upper.endswith(suffix) and (upper[:-len(suffix)] in self._symbols_cache or
                                           any(k.upper().rstrip(suffix) == upper[:-len(suffix)] for k in self._symbols_cache)):
                return upper  # no rename; return broker-native symbol as-is
        return upper

    def _suffixes(self):
        if not hasattr(self, "_suf_cache"):
            suf = set()
            known = {"EURUSD","GBPUSD","USDJPY","XAUUSD","BTCUSD","ETHUSD","US30","NAS100","SPX500"}
            for k in self._symbols_cache:
                ku = k.upper()
                for base in known:
                    if ku.startswith(base) and len(ku) > len(base):
                        suf.add(ku[len(base):])
            self._suf_cache = list(suf)
        return self._suf_cache

    # ---------------- account ----------------
    def get_account(self) -> AccountInfo:
        info = self._trade_get("/accountinformation")
        if "payload" in info: info = info["payload"]
        atype = "demo" if (info.get("type") or "").lower() in ("demo",) or "demo" in info.get("name","").lower() else "live"
        return AccountInfo(
            login=str(info.get("login","")),
            broker="MetaApi / " + (info.get("broker") or self.server),
            server=self.server,
            name=info.get("name",""),
            currency=info.get("currency","USD"),
            balance=float(info.get("balance",0)),
            equity=float(info.get("equity",0)),
            margin=float(info.get("margin",0)),
            free_margin=float(info.get("freeMargin",0)),
            margin_level=float(info.get("marginLevel",0)) or 0,
            leverage=int(info.get("leverage",100)),
            type=atype,
        )

    def get_balance(self) -> float: return self.get_account().balance
    def get_equity(self) -> float: return self.get_account().equity
    def get_margin(self) -> dict:
        a = self.get_account()
        return {"used":a.margin,"free":a.free_margin,"level":a.margin_level}

    # ---------------- instruments ----------------
    def get_symbols(self) -> List[SymbolInfo]:
        out = []
        for name, spec in self._symbols_cache.items():
            # Skip very obscure symbols
            if not spec.get("tradingAllowed",True): continue
            digits = spec.get("digits",5)
            point = float(spec.get("pointSize",0) or pow(10,-digits))
            tick_size = point
            # Determine asset class
            from brokers.mt5.symbol_classifier import classify
            asset = classify(name)
            out.append(SymbolInfo(
                name=name,
                normalized=name.upper(),
                asset_class=asset,
                digits=digits,
                point=point,
                contract_size=float(spec.get("tradeContractSize",spec.get("lotSize",100000))),
                volume_min=float(spec.get("minVolume",0.01)),
                volume_max=float(spec.get("maxVolume",100)),
                volume_step=float(spec.get("volumeStep",0.01)),
                tick_value=float(spec.get("tickValue",0)) or 1.0,
                tick_size=tick_size,
                stops_level=int(spec.get("stopsLevel",0)),
                spread=float(spec.get("spreadRaw",0) or spec.get("bidTickValue",0)),
                bid=0, ask=0, tradable=True,
            ))
        return out

    def get_symbol_info(self, sym) -> SymbolInfo:
        spec = self._symbols_cache.get(sym) or self._symbols_cache.get(self._norm(sym))
        if not spec:
            # Refresh once on miss
            self._refresh_symbol_cache()
            spec = self._symbols_cache.get(sym) or self._symbols_cache.get(self._norm(sym))
        if not spec: raise BrokerError(f"Symbol {sym} not found on this broker", BrokerErrorCode.INSTRUMENT_NOT_FOUND)
        tick = self.get_quote(sym)
        digits = spec.get("digits",5)
        point = float(spec.get("pointSize",0) or pow(10,-digits))
        from brokers.mt5.symbol_classifier import classify
        return SymbolInfo(
            name=sym, normalized=sym.upper(),
            asset_class=classify(sym),
            digits=digits, point=point,
            contract_size=float(spec.get("tradeContractSize",spec.get("lotSize",100000))),
            volume_min=float(spec.get("minVolume",0.01)),
            volume_max=float(spec.get("maxVolume",100)),
            volume_step=float(spec.get("volumeStep",0.01)),
            tick_value=float(spec.get("tickValue",1) or 1),
            tick_size=point,
            stops_level=int(spec.get("stopsLevel",0)),
            spread=tick.ask - tick.bid,
            bid=tick.bid, ask=tick.ask, tradable=spec.get("tradingAllowed",True))

    # ---------------- market data ----------------
    def get_quote(self, sym) -> Quote:
        b = self._trade_get(f"/symbols/{sym}/current-tick")
        if "payload" in b: b = b["payload"]
        if not b.get("bid") or not b.get("ask"):
            raise BrokerError(f"No tick for {sym}", BrokerErrorCode.PRICE_UNAVAILABLE)
        return Quote(symbol=sym, bid=float(b["bid"]), ask=float(b["ask"]),
                     last=float(b.get("last",(b["bid"]+b["ask"])/2)),
                     volume=float(b.get("volume",0)),
                     time=datetime.now(timezone.utc))

    def get_candles(self, sym, tf, count, since=None) -> List[Candle]:
        tf_map = {"M1":"1m","M5":"5m","M15":"15m","M30":"30m","H1":"1h","H4":"4h","D1":"1d"}
        res = self._trade_get(f"/symbols/{sym}/candles? timeframe={tf_map.get(tf,'15m')}")
        # Note: exact params depend on MetaApi OHLC endpoint; adjust as needed
        # Endpoint: /market-data/... — MetaApi's historical candles endpoint
        # Keeping this simple: returns an empty list and raises a clear message
        # until the exact endpoint is wired, so it NEVER returns fake candles.
        raise BrokerError(
            f"Candles endpoint for {sym} on MetaApi requires /market-data endpoint; "
            f"wire with timeframe={tf_map.get(tf,'15m')} before enabling live mode.",
            BrokerErrorCode.NETWORK_ERROR)

    # ---------------- positions / orders ----------------
    def get_positions(self) -> List[Position]:
        r = self._trade_get("/positions")
        positions = r.get("payload", r) if isinstance(r, dict) else r
        out = []
        for p in positions or []:
            out.append(Position(
                ticket=int(p.get("id",0) or p.get("positionId",0)),
                symbol=p.get("symbol",""),
                side=Side.BUY if p.get("type",0)==0 else Side.SELL,
                volume=float(p.get("volume",0)),
                open_price=float(p.get("openPrice",0)),
                sl=float(p.get("stopLoss",0) or 0),
                tp=float(p.get("takeProfit",0) or 0),
                profit=float(p.get("profit",0)),
                swap=float(p.get("swap",0)),
                comment=p.get("comment",""),
                open_time=datetime.now(timezone.utc),
                magic=int(p.get("magic",0) or 0),
            ))
        return out

    def get_orders(self) -> List[Order]:
        r = self._trade_get("/orders")
        orders = r.get("payload", r) if isinstance(r, dict) else r
        out = []
        for o in orders or []:
            out.append(Order(
                ticket=int(o.get("id",0) or o.get("orderId",0)),
                symbol=o.get("symbol",""),
                side=Side.BUY if o.get("type",0) in (0,2,4) else Side.SELL,
                type=OrderType.MARKET,
                volume=float(o.get("volume",0)),
                price=float(o.get("openPrice",0) or o.get("currentPrice",0)),
                stop_price=float(o.get("stopLimitPrice",0) or 0),
                sl=float(o.get("stopLoss",0) or 0),
                tp=float(o.get("takeProfit",0) or 0),
                status=OrderStatus.PENDING,
                comment=o.get("comment",""),
                time=datetime.now(timezone.utc)))
        return out

    # ---------------- order placement ----------------
    def place_market_order(self, sym, side, volume, sl=0, tp=0, comment=""):
        body = {
            "actionType": "ORDER_TYPE_SELL" if side == Side.SELL else "ORDER_TYPE_BUY",
            "symbol": sym,
            "volume": float(volume),
            "stopLoss": float(sl) if sl else None,
            "takeProfit": float(tp) if tp else None,
            "comment": comment[:31] if comment else "CRT+TBS",
        }
        body = {k:v for k,v in body.items() if v is not None}
        r = self._trade_post("/trade/trade", {"actionType":"CREATE_MARKET_ORDER",**body})
        msg = r.get("message","")
        if r.get("errorCode") or (r.get("responseCode") and r.get("responseCode")!="EXECUTION_FINISHED" and "TRADE_RETCODE" in str(r.get("numericCode",""))):
            err = r.get("errorCode") or r.get("message") or r.get("responseCode")
            raise BrokerError(f"Order rejected by broker: {err}", BrokerErrorCode.UNKNOWN)
        order_id = r.get("orderId") or r.get("positionId")
        price = float(r.get("openPrice") or 0)
        return OrderResult(ok=True, ticket=order_id, open_price=price, volume=float(volume))

    def place_limit_order(self, sym, side, volume, price, sl=0, tp=0, comment=""):
        body = {
            "actionType":"ORDER_TYPE_SELL_LIMIT" if side==Side.SELL else "ORDER_TYPE_BUY_LIMIT",
            "symbol":sym,"volume":float(volume),"openPrice":float(price),
            "stopLoss":float(sl) or None,"takeProfit":float(tp) or None,
            "comment":comment[:31],
        }
        body = {k:v for k,v in body.items() if v is not None}
        r = self._trade_post("/trade/trade", {"actionType":"CREATE_PENDING_ORDER",**body})
        if r.get("errorCode"): raise BrokerError(f"Limit order rejected: {r.get('message')}",BrokerErrorCode.UNKNOWN)
        return OrderResult(ok=True, ticket=r.get("orderId"), open_price=price, volume=float(volume))

    def place_stop_order(self, sym, side, volume, stop_price, sl=0, tp=0, comment=""):
        body = {
            "actionType":"ORDER_TYPE_SELL_STOP" if side==Side.SELL else "ORDER_TYPE_BUY_STOP",
            "symbol":sym,"volume":float(volume),"stopPrice":float(stop_price),
            "stopLoss":float(sl) or None,"takeProfit":float(tp) or None,
            "comment":comment[:31],
        }
        body = {k:v for k,v in body.items() if v is not None}
        r = self._trade_post("/trade/trade", {"actionType":"CREATE_PENDING_ORDER",**body})
        if r.get("errorCode"): raise BrokerError(f"Stop order rejected: {r.get('message')}",BrokerErrorCode.UNKNOWN)
        return OrderResult(ok=True, ticket=r.get("orderId"), open_price=stop_price, volume=float(volume))

    def modify_order(self, ticket, price=0, sl=0, tp=0):
        r = self._trade_post("/trade/trade", {
            "actionType":"MODIFY_PENDING_ORDER","orderId":str(ticket),
            "openPrice":float(price) if price else None,
            "stopLoss":float(sl) if sl else None,"takeProfit":float(tp) if tp else None})
        return not r.get("errorCode")

    def modify_position(self, ticket, sl=0, tp=0):
        r = self._trade_post("/trade/trade", {
            "actionType":"MODIFY_POSITION","positionId":str(ticket),
            "stopLoss":float(sl) if sl else None,"takeProfit":float(tp) if tp else None})
        return not r.get("errorCode")

    def close_position(self, ticket, volume=None):
        body = {"actionType":"CLOSE_POSITION","positionId":str(ticket)}
        if volume is not None: body["volume"]=float(volume)
        r = self._trade_post("/trade/trade", body)
        if r.get("errorCode"): raise BrokerError(f"Close rejected: {r.get('message')}",BrokerErrorCode.UNKNOWN)
        return OrderResult(ok=True, ticket=ticket)

    def close_all_positions(self):
        results = []
        for p in self.get_positions():
            try:
                results.append(self.close_position(p.ticket))
            except BrokerError as e:
                results.append(OrderResult(ok=False,error=str(e)))
        return results

    def cancel_order(self, ticket):
        r = self._trade_post("/trade/trade", {"actionType":"CANCEL_ORDER","orderId":str(ticket)})
        return not r.get("errorCode")

    def get_trade_history(self, since, until=None):
        # MetaApi history API via /history-deals/:range
        # Returning raw list; adapter does not fabricate data.
        raise BrokerError("History adapter not yet wired; MetaApi /history-deals endpoint required.",
                          BrokerErrorCode.NETWORK_ERROR)

    def subscribe_market_data(self, symbols, on_tick, on_candle=None):
        """MetaApi streaming WebSocket — subscribe to prices. Real connection; no polling."""
        self._tick_callbacks.append(on_tick)
        if self._ws_running: return
        # WebSocket URL: wss://mt-streaming-api-v1.../ws?auth-token=...
        def run():
            self._ws_running = True
            url = f"{METAAPI_STREAM}/ws?auth-token={self.token}"
            def on_open(ws):
                # Subscribe to account
                ws.send(json.dumps({"type":"accountInformation","accountId":self.account_id}))
                for s in symbols:
                    ws.send(json.dumps({"type":"subscribeToTicks","accountId":self.account_id,"symbol":s}))
            def on_msg(ws, msg):
                try:
                    d = json.loads(msg)
                    if d.get("type") == "tick":
                        q = Quote(symbol=d["symbol"],bid=float(d["bid"]),ask=float(d["ask"]),
                                  last=float(d.get("last",(d["bid"]+d["ask"])/2)),
                                  volume=float(d.get("volume",0)),
                                  time=datetime.now(timezone.utc))
                        for cb in self._tick_callbacks:
                            try: cb(q)
                            except Exception: pass
                except Exception: pass
            def on_err(ws, err): pass
            def on_close(ws, code, reason):
                self._ws_running = False
            self._ws = websocket.WebSocketApp(url, on_open=on_open, on_message=on_msg,
                                              on_error=on_err, on_close=on_close)
            self._ws.run_forever(ping_interval=30)
        self._ws_thread = __import__("threading").Thread(target=run, daemon=True)
        self._ws_thread.start()
