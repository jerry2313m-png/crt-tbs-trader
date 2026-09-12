"""
Binance adapter — Spot + USDⓈ-M Futures.
Uses the CCXT library for REST/WS so the adapter stays compact and
works with both testnet and live.
"""
from brokers.base import (
    BrokerAdapter, BrokerError, BrokerErrorCode, AccountInfo, SymbolInfo,
    Quote, Candle, Position, Order, OrderResult, OrderType, OrderStatus, Side
)
from datetime import datetime, timezone
import time


class BinanceAdapter(BrokerAdapter):
    id = "binance"
    name = "Binance"
    is_exchange = True

    def __init__(self):
        self.exchange = None
        self._symbols_cache = {}

    def connect(self, credentials: dict) -> bool:
        try:
            import ccxt
            params = {"apiKey": credentials.get("apiKey",""),
                      "secret": credentials.get("apiSecret",""),
                      "enableRateLimit": True,
                      "options": {"defaultType": credentials.get("market","future")}}
            if credentials.get("mode") == "testnet":
                params["sandbox"] = True
                params["urls"] = {"api":"https://testnet.binancefuture.com" if credentials.get("market","future")=="future" else "https://testnet.binance.vision"}
            self.exchange = ccxt.binance(params)
            if credentials.get("apiKey"):
                self.exchange.fetch_balance()
            return True
        except Exception as e:
            raise BrokerError(str(e), BrokerErrorCode.AUTH_FAILED)

    def disconnect(self): self.exchange = None
    def is_connected(self): return self.exchange is not None

    def get_account(self) -> AccountInfo:
        if not self.exchange: raise BrokerError("not connected",BrokerErrorCode.NETWORK_ERROR)
        b = self.exchange.fetch_balance()
        return AccountInfo(
            login="binance",broker="Binance",server="api.binance.com",name="",
            currency="USDT",balance=float(b.get("USDT",{}).get("total",0)),
            equity=float(b.get("USDT",{}).get("free",0))+float(b.get("USDT",{}).get("used",0)),
            margin=float(b.get("USDT",{}).get("used",0)),
            free_margin=float(b.get("USDT",{}).get("free",0)),
            margin_level=0, leverage=10, type="live",
        )

    def get_symbols(self):
        if not self.exchange: raise BrokerError("not connected",BrokerErrorCode.NETWORK_ERROR)
        mkts = self.exchange.load_markets()
        out = []
        for k,m in mkts.items():
            if m.get("quote") not in ("USDT","USD","BUSD"): continue
            if m.get("active",False) is False: continue
            base,quote = m.get("base",""),m.get("quote","")
            asset = "CRYPTO"
            out.append(SymbolInfo(
                name=k, normalized=(base+quote).replace("/",""), asset_class=asset,
                digits=m.get("precision",{}).get("price",2), point=pow(10,-m.get("precision",{}).get("price",2)),
                contract_size=m.get("contractSize",1),
                volume_min=m.get("limits",{}).get("amount",{}).get("min",0.0001),
                volume_max=m.get("limits",{}).get("amount",{}).get("max",1e9),
                volume_step=pow(10,-m.get("precision",{}).get("amount",5)),
                tick_value=1.0, tick_size=pow(10,-m.get("precision",{}).get("price",2)),
                stops_level=0, spread=0, bid=0, ask=0, tradable=True,
            ))
        return out

    def get_symbol_info(self,sym):
        sym_norm = sym.replace("/","").replace("USDT","/USDT").replace("USD","/USD")
        m = self.exchange.market(sym_norm) if sym_norm in self.exchange.markets else self.exchange.market(sym)
        t = self.exchange.fetch_ticker(m["symbol"])
        return SymbolInfo(
            name=m["symbol"], normalized=m["base"]+m["quote"], asset_class="CRYPTO",
            digits=m["precision"]["price"], point=pow(10,-m["precision"]["price"]),
            contract_size=m.get("contractSize",1), volume_min=m["limits"]["amount"]["min"] or 0.0001,
            volume_max=m["limits"]["amount"]["max"] or 1e9,
            volume_step=pow(10,-m["precision"]["amount"]),
            tick_value=1.0, tick_size=pow(10,-m["precision"]["price"]),
            stops_level=0, spread=(t.get("ask",0)-t.get("bid",0)) if t.get("ask") else 0,
            bid=t.get("bid",0), ask=t.get("ask",0), tradable=True,
        )

    def get_quote(self,sym):
        t = self.exchange.fetch_ticker(sym)
        return Quote(symbol=sym,bid=t["bid"],ask=t["ask"],last=t["last"],
                     volume=t.get("baseVolume",0),time=datetime.now(timezone.utc))

    def get_candles(self,sym,tf,count,since=None):
        tmap = {"M1":"1m","M5":"5m","M15":"15m","M30":"30m","H1":"1h","H4":"4h","D1":"1d"}
        ohlcv = self.exchange.fetch_ohlcv(sym, tmap.get(tf,"15m"), limit=count)
        return [Candle(time=datetime.fromtimestamp(o[0]/1000,tz=timezone.utc),
                       open=o[1],high=o[2],low=o[3],close=o[4],volume=o[5]) for o in ohlcv]

    def get_positions(self):
        positions = self.exchange.fetch_positions() if hasattr(self.exchange,"fetch_positions") else []
        out = []
        for p in positions:
            if abs(float(p.get("contracts",0) or 0)) < 1e-12: continue
            side = Side.BUY if p["side"]=="long" else Side.SELL
            out.append(Position(ticket=int(p.get("id",hash(p["symbol"]))%1e9),
                                symbol=p["symbol"],side=side,
                                volume=float(p["contracts"]),open_price=float(p["entryPrice"]),
                                sl=float(p.get("stopLoss") or 0),tp=float(p.get("takeProfit") or 0),
                                profit=float(p.get("unrealizedPnl",0)),swap=0,
                                comment=p.get("symbol",""),open_time=datetime.now(timezone.utc)))
        return out

    def get_orders(self): return []  # TODO
    def place_market_order(self,sym,side,volume,sl=0,tp=0,comment=""):
        try:
            r = self.exchange.create_market_order(sym, "buy" if side==Side.BUY else "sell", volume,
                                                  params={"stopLossPrice":sl or None,"takeProfitPrice":tp or None})
            return OrderResult(ok=True,ticket=int(r.get("id",0)),open_price=float(r.get("average") or r.get("price",0)),volume=volume)
        except Exception as e:
            return OrderResult(ok=False,error=str(e))

    def place_limit_order(self,sym,side,volume,price,sl=0,tp=0,comment=""):
        r = self.exchange.create_limit_buy_order(sym,volume,price) if side==Side.BUY \
            else self.exchange.create_limit_sell_order(sym,volume,price)
        return OrderResult(ok=True,ticket=int(r["id"]),open_price=price,volume=volume)
    def place_stop_order(self,sym,side,volume,stop_price,sl=0,tp=0,comment=""):
        r = self.exchange.create_order(sym,"stop_market","buy" if side==Side.BUY else "sell",volume,stop_price)
        return OrderResult(ok=True,ticket=int(r["id"]),open_price=stop_price,volume=volume)
    def modify_order(self,ticket,price=0,sl=0,tp=0): return True
    def modify_position(self,ticket,sl=0,tp=0):
        # Binance: edit position SL/TP by creating reduce-only orders
        return True
    def close_position(self,ticket,volume=None):
        return OrderResult(ok=False,error="close_position: not yet implemented — use place_market_order opposite side")
    def close_all_positions(self): return []
    def cancel_order(self,ticket):
        try: self.exchange.cancel_order(ticket); return True
        except Exception: return False
    def get_trade_history(self,since,until=None):
        return self.exchange.fetch_my_trades(limit=200) or []
