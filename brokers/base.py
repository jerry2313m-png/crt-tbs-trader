"""
============================================
BrokerAdapter — Standard Interface
============================================

Every broker/exchange adapter MUST implement this interface.
The strategy engine, risk engine, and position manager communicate
ONLY through this interface — they contain zero broker-specific code.

Per-broker modules live in:
    brokers/mt5/        MetaTrader 5 (local bridge / MetaApi)
    brokers/ctrader/    cTrader Open API
    brokers/binance/    Binance Spot/Futures
    brokers/coinbase/   Coinbase Advanced Trade

Methods:
    connect(credentials) -> bool
    disconnect() -> None
    getAccount()        -> AccountInfo
    getBalance()        -> float
    getEquity()         -> float
    getMargin()         -> MarginInfo
    getSymbols()        -> list[SymbolInfo]
    getSymbolInfo(sym)  -> SymbolInfo
    getQuote(sym)       -> Quote
    getCandles(sym, tf, count, since=None) -> list[Candle]
    getPositions()      -> list[Position]
    getOrders()         -> list[Order]
    placeMarketOrder(sym, side, lot, sl, tp, comment) -> OrderResult
    placeLimitOrder(sym, side, lot, price, sl, tp, comment) -> OrderResult
    placeStopOrder(sym, side, lot, stopPrice, sl, tp, comment) -> OrderResult
    modifyOrder(ticket, price, sl, tp) -> bool
    modifyPosition(ticket, sl, tp)     -> bool
    closePosition(ticket, lot=None)    -> OrderResult
    closeAllPositions()                -> list[OrderResult]
    cancelOrder(ticket)                -> bool
    getTradeHistory(since, until)      -> list[Trade]
    subscribeMarketData(symbols, onTick, onCandle) -> Subscription

All methods MUST raise BrokerError on failure with a structured error code
so the trading controller can decide fail-safe behavior.

Never swallow exceptions silently.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Callable, List, Optional


class Side(Enum):
    BUY = "buy"
    SELL = "sell"


class OrderType(Enum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class OrderStatus(Enum):
    PENDING = "pending"
    FILLED = "filled"
    PARTIAL = "partial"
    CANCELED = "canceled"
    REJECTED = "rejected"
    EXPIRED = "expired"


class BrokerErrorCode(Enum):
    NETWORK_ERROR = "network_error"
    AUTH_FAILED = "auth_failed"
    RATE_LIMITED = "rate_limited"
    INSTRUMENT_NOT_FOUND = "instrument_not_found"
    MARKET_CLOSED = "market_closed"
    INSUFFICIENT_MARGIN = "insufficient_margin"
    INVALID_VOLUME = "invalid_volume"
    STOPS_TOO_CLOSE = "stops_too_close"
    PRICE_UNAVAILABLE = "price_unavailable"
    STALE_DATA = "stale_data"
    RECONNECTING = "reconnecting"
    UNKNOWN = "unknown"


class BrokerError(Exception):
    def __init__(self, message: str, code: BrokerErrorCode = BrokerErrorCode.UNKNOWN, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass
class AccountInfo:
    login: str
    broker: str
    server: str
    name: str
    currency: str
    balance: float
    equity: float
    margin: float
    free_margin: float
    margin_level: float
    leverage: int
    type: str             # "demo" | "live"


@dataclass
class SymbolInfo:
    name: str
    normalized: str       # e.g. "XAUUSD" for "XAUUSDm"
    asset_class: str      # FOREX | GOLD | CRYPTO | INDEX
    digits: int
    point: float
    contract_size: float
    volume_min: float
    volume_max: float
    volume_step: float
    tick_value: float
    tick_size: float
    stops_level: int
    spread: float
    bid: float
    ask: float
    tradable: bool
    trading_hours: Optional[dict] = None


@dataclass
class Quote:
    symbol: str
    bid: float
    ask: float
    last: float
    volume: float
    time: datetime


@dataclass
class Candle:
    time: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Position:
    ticket: int
    symbol: str
    side: Side
    volume: float
    open_price: float
    sl: float
    tp: float
    profit: float
    swap: float
    comment: str
    open_time: datetime
    magic: int = 0


@dataclass
class Order:
    ticket: int
    symbol: str
    side: Side
    type: OrderType
    volume: float
    price: float
    stop_price: float
    sl: float
    tp: float
    status: OrderStatus
    comment: str
    time: datetime


@dataclass
class OrderResult:
    ok: bool
    ticket: Optional[int] = None
    open_price: Optional[float] = None
    volume: Optional[float] = None
    error: Optional[str] = None
    retcode: Optional[int] = None
    raw: dict = field(default_factory=dict)


class BrokerAdapter(ABC):
    """Subclass this for every broker/exchange."""

    id: str = ""
    name: str = ""
    is_exchange: bool = False  # true for crypto exchanges

    # -------- lifecycle --------
    @abstractmethod
    def connect(self, credentials: dict) -> bool: ...
    @abstractmethod
    def disconnect(self) -> None: ...
    @abstractmethod
    def is_connected(self) -> bool: ...

    # -------- account --------
    @abstractmethod
    def get_account(self) -> AccountInfo: ...
    def get_balance(self) -> float: return self.get_account().balance
    def get_equity(self) -> float: return self.get_account().equity
    def get_margin(self) -> dict:
        a = self.get_account()
        return {"used": a.margin, "free": a.free_margin, "level": a.margin_level}

    # -------- instruments --------
    @abstractmethod
    def get_symbols(self) -> List[SymbolInfo]: ...
    @abstractmethod
    def get_symbol_info(self, sym: str) -> SymbolInfo: ...

    # -------- market data --------
    @abstractmethod
    def get_quote(self, sym: str) -> Quote: ...
    @abstractmethod
    def get_candles(self, sym: str, tf: str, count: int, since: Optional[datetime] = None) -> List[Candle]: ...
    def subscribe_market_data(self, symbols: List[str], on_tick: Callable, on_candle: Callable = None):
        """Optional: subscribe to real-time ticks via websocket."""
        raise NotImplementedError

    # -------- positions / orders --------
    @abstractmethod
    def get_positions(self) -> List[Position]: ...
    @abstractmethod
    def get_orders(self) -> List[Order]: ...

    @abstractmethod
    def place_market_order(self, sym: str, side: Side, volume: float,
                           sl: float = 0, tp: float = 0, comment: str = "") -> OrderResult: ...
    @abstractmethod
    def place_limit_order(self, sym: str, side: Side, volume: float, price: float,
                          sl: float = 0, tp: float = 0, comment: str = "") -> OrderResult: ...
    @abstractmethod
    def place_stop_order(self, sym: str, side: Side, volume: float, stop_price: float,
                         sl: float = 0, tp: float = 0, comment: str = "") -> OrderResult: ...
    @abstractmethod
    def modify_order(self, ticket: int, price: float = 0, sl: float = 0, tp: float = 0) -> bool: ...
    @abstractmethod
    def modify_position(self, ticket: int, sl: float = 0, tp: float = 0) -> bool: ...
    @abstractmethod
    def close_position(self, ticket: int, volume: float = None) -> OrderResult: ...
    @abstractmethod
    def close_all_positions(self) -> List[OrderResult]: ...
    @abstractmethod
    def cancel_order(self, ticket: int) -> bool: ...
    @abstractmethod
    def get_trade_history(self, since: datetime, until: datetime = None) -> List[dict]: ...
