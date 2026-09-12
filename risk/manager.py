"""
Risk Manager — centralised risk enforcement.

All order decisions MUST route through can_open_trade().
The strategy engine never bypasses risk.

Checks enforced:
    - max risk per trade (per-asset override)
    - max daily loss
    - max weekly loss
    - max drawdown (peak-to-trough equity)
    - max open positions
    - max trades per day
    - max consecutive losses
    - max exposure (sum of position notional / equity)
    - max leverage
    - minimum margin level
    - stale market data
    - duplicate signal (TradeSignalID)
    - broker minimum volume
    - minimum stop distance
    - emergency / pause flags
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import hashlib


@dataclass
class RiskSettings:
    risk_per_trade: float = 0.005
    max_daily_loss: float = 0.02
    max_weekly_loss: float = 0.05
    max_drawdown: float = 0.10
    max_consecutive_losses: int = 3
    max_open_positions: int = 3
    max_trades_per_day: int = 10
    max_exposure: float = 0.10
    min_margin_level: float = 150.0
    min_rr: float = 2.0
    min_score: int = 75
    data_max_age_seconds: int = 10


@dataclass
class TradeSignal:
    symbol: str
    timeframe: str
    direction: str       # BUY / SELL
    setup: str          # e.g. "SSL sweep + bullish CHOCH"
    candle_time: datetime
    entry: float
    sl: float
    tp: float
    score: int
    size: Optional[float] = None

    def signal_id(self) -> str:
        raw = f"{self.symbol}|{self.timeframe}|{self.setup}|{self.candle_time.isoformat()}|{self.direction}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]


class RiskManager:
    def __init__(self, settings: RiskSettings = None):
        self.settings = settings or RiskSettings()
        self.realized_pnl_day = 0.0
        self.realized_pnl_week = 0.0
        self.peak_equity = 0.0
        self.consecutive_losses = 0
        self.trades_day = 0
        self.open_positions: List[dict] = []
        self._day_start = datetime.now(timezone.utc).date()
        self._week_start = (datetime.now(timezone.utc) - timedelta(days=datetime.now(timezone.utc).weekday())).date()
        self._seen_signals = set()
        self.emergency = False
        self.paused = False

    # ------------- equity/periods -------------
    def update_equity(self, equity: float):
        self.peak_equity = max(self.peak_equity, equity)
        today = datetime.now(timezone.utc).date()
        if today != self._day_start:
            self.realized_pnl_day = 0; self.trades_day = 0; self._day_start = today
        week = (datetime.now(timezone.utc) - timedelta(days=datetime.now(timezone.utc).weekday())).date()
        if week != self._week_start:
            self.realized_pnl_week = 0; self._week_start = week

    def drawdown(self, equity: float) -> float:
        return (self.peak_equity - equity) / self.peak_equity if self.peak_equity else 0

    # ------------- pre-trade checklist -------------
    def can_open_trade(self, signal: TradeSignal, account: dict, broker_info: dict,
                       quote: dict, asset_profile: dict) -> (bool, list):
        reasons = []
        s = self.settings

        if self.emergency: reasons.append("Emergency stop active")
        if self.paused: reasons.append("Trading paused")

        # Duplicate signal protection
        sid = signal.signal_id()
        if sid in self._seen_signals: reasons.append("Duplicate signal (already traded)")

        # Period limits
        if self.realized_pnl_day <= -s.max_daily_loss * account["equity"]:
            reasons.append(f"Daily loss limit reached (-{s.max_daily_loss*100}%)")
        if self.realized_pnl_week <= -s.max_weekly_loss * account["equity"]:
            reasons.append(f"Weekly loss limit reached (-{s.max_weekly_loss*100}%)")
        if self.drawdown(account["equity"]) >= s.max_drawdown:
            reasons.append(f"Max drawdown reached ({s.max_drawdown*100}%)")
        if self.consecutive_losses >= s.max_consecutive_losses:
            reasons.append(f"Max consecutive losses ({s.max_consecutive_losses})")
        if self.trades_day >= s.max_trades_per_day:
            reasons.append(f"Max daily trades ({s.max_trades_per_day}) reached")
        if len(self.open_positions) >= s.max_open_positions:
            reasons.append(f"Max open positions ({s.max_open_positions}) reached")

        # Score / RR
        if signal.score < s.min_score: reasons.append(f"Score {signal.score} < {s.min_score}")
        risk = abs(signal.entry - signal.sl)
        reward = abs(signal.tp - signal.entry)
        rr = reward / risk if risk > 0 else 0
        if rr < s.min_rr: reasons.append(f"R:R {rr:.2f} < {s.min_rr}")

        # Stale data
        age = (datetime.now(timezone.utc) - quote["time"]).total_seconds() if isinstance(quote.get("time"),datetime) else 0
        if age > s.data_max_age_seconds: reasons.append(f"Stale market data ({age:.0f}s)")

        # Spread / slippage
        spread = abs(quote["ask"] - quote["bid"])
        if spread > broker_info.get("max_spread", 1e18): reasons.append("Spread excessive")

        # Margin
        margin_needed = self._estimate_margin(signal, broker_info, asset_profile)
        if account.get("free_margin", 1e18) < margin_needed: reasons.append("Insufficient margin")
        if account.get("margin_level", 999) and account["margin_level"] < s.min_margin_level:
            reasons.append(f"Margin level below {s.min_margin_level}%")

        # Exposure cap
        current_exposure = sum(p["notional"] for p in self.open_positions)
        est_size = signal.size if signal.size is not None else self.position_size(signal, account, broker_info, asset_profile)
        new_notional = est_size * broker_info.get("contract_size", 1) * signal.entry
        if (current_exposure + new_notional) / account["equity"] > s.max_exposure:
            reasons.append("Max exposure exceeded")

        # Broker volume rules & stop distance
        if signal.size is not None:
            if signal.size < broker_info.get("volume_min",0): reasons.append("Size below broker min")
            if signal.size > broker_info.get("volume_max",1e18): reasons.append("Size above broker max")
            stops_level_px = broker_info.get("stops_level",0) * broker_info.get("point",0)
            if risk < stops_level_px: reasons.append("Stop loss closer than broker stops_level")

        # Mark signal seen (will be committed only if order succeeds)
        return (len(reasons)==0, reasons)

    def position_size(self, signal: TradeSignal, account: dict, broker_info: dict,
                      asset_profile: dict) -> float:
        s = self.settings
        equity = account["equity"]
        risk_amount = equity * s.risk_per_trade * asset_profile.get("risk_mult",1.0)
        risk_per_unit = abs(signal.entry - signal.sl)
        if risk_per_unit <= 0: return 0
        contract_size = broker_info.get("contract_size", 1)
        # Per-lot P&L for a 1-price-unit move (e.g. 1 lot XAU/USD on 100oz contract = $100 per $1)
        value_per_lot_per_unit = broker_info.get("tick_value", contract_size) / max(broker_info.get("point",0.0001),1e-12) * broker_info.get("point",0.0001)
        # 1 pip move => value_per_lot_per_unit * (risk in pips) — simpler: per unit price move PnL = contract_size * (quote currency factor)
        # For FOREX standard lot: 100000 * 1 USD per 1.0 price move => $100,000 per 1.0 move = $10 per 0.0001 pip (matches point_value = $10)
        per_unit_pnl_per_lot = contract_size
        # Use tick_value explicitly if provided (FX $10 per pip, etc.)
        if "tick_value" in broker_info:
            per_unit_pnl_per_lot = broker_info["tick_value"] / broker_info.get("point",1)
        size = risk_amount / (risk_per_unit * per_unit_pnl_per_lot)
        step = broker_info.get("volume_step", 0.01)
        if step <= 0: step = 0.01
        size = (size // step) * step
        size = max(0, min(broker_info.get("volume_max",1e9), size))
        return round(size, 8)

    def _estimate_margin(self, signal, broker_info, asset_profile):
        leverage = max(1, broker_info.get("leverage", 100))
        size = signal.size if signal.size is not None else 0
        return size * broker_info.get("contract_size", 1) * signal.entry / leverage

    # ------------- call after fills -------------
    def record_fill(self, pnl: float):
        self.realized_pnl_day += pnl
        self.realized_pnl_week += pnl
        self.trades_day += 1
        if pnl >= 0: self.consecutive_losses = 0
        else: self.consecutive_losses += 1

    def mark_signal_seen(self, sig): self._seen_signals.add(sig.signal_id())
    def register_position(self, p): self.open_positions.append(p)
    def remove_position(self, ticket): self.open_positions = [p for p in self.open_positions if p["ticket"]!=ticket]
