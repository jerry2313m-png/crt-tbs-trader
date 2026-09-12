"""
Coinbase Advanced Trade adapter (ccxt).
"""
from brokers.binance import BinanceAdapter  # coinbase uses ccxt too; reuse logic
import ccxt

class CoinbaseAdapter(BinanceAdapter):
    id = "coinbase"
    name = "Coinbase Advanced Trade"
    is_exchange = True

    def connect(self, credentials: dict) -> bool:
        try:
            self.exchange = ccxt.coinbaseadvanced({
                "apiKey": credentials.get("apiKey",""),
                "secret": credentials.get("apiSecret",""),
                "enableRateLimit": True,
            })
            if credentials.get("mode")=="sandbox":
                self.exchange.set_sandbox_mode(True)
            if credentials.get("apiKey"): self.exchange.fetch_balance()
            return True
        except Exception as e:
            raise Exception("Coinbase connect failed: " + str(e))
