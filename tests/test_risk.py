import sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from datetime import datetime, timezone
from risk.manager import RiskManager, RiskSettings, TradeSignal

def test_position_size():
    rm = RiskManager(RiskSettings(risk_per_trade=0.01))
    rm.update_equity(10000)
    sig = TradeSignal(symbol="EURUSD",timeframe="M15",direction="BUY",setup="test",
                      candle_time=datetime.now(timezone.utc),entry=1.1000,sl=1.0980,tp=1.1040,score=80)
    broker = {"volume_min":0.01,"volume_max":100,"volume_step":0.01,"stops_level":5,"point":0.0001,
              "contract_size":100000,"tick_value":10.0,"leverage":500,"max_spread":0.0003}
    sz = rm.position_size(sig, {"equity":10000,"free_margin":9000,"margin_level":9999}, broker, {})
    assert sz > 0
    # Risk should equal ~100$ (1% of 10k)
    risk = abs(sig.entry - sig.sl) * broker["contract_size"] * sz
    assert abs(risk - 100) < 15, f"Expected $100 risk, got ${risk:.2f}"

def test_daily_loss_blocks_trade():
    rm = RiskManager(RiskSettings(max_daily_loss=0.02))
    rm.update_equity(10000)
    rm.realized_pnl_day = -250  # -2.5% > -2%
    sig = TradeSignal("EURUSD","M15","BUY","t",datetime.now(timezone.utc),1.1,1.098,1.104,80)
    ok, reasons = rm.can_open_trade(sig,
        {"equity":9750,"free_margin":9750,"margin_level":9999},
        {"max_spread":0.001,"volume_min":0.01,"volume_max":100,"volume_step":0.01,"stops_level":0,"point":0.0001,
         "contract_size":100000,"point_value":1.0,"leverage":500},
        {"ask":1.1,"bid":1.0999,"time":datetime.now(timezone.utc)},
        {})
    assert not ok and any("Daily loss" in r for r in reasons)

def test_duplicate_signal():
    rm = RiskManager()
    rm.update_equity(10000)
    sig = TradeSignal("EURUSD","M15","BUY","setupA",datetime.now(timezone.utc),1.1,1.098,1.104,80)
    rm.mark_signal_seen(sig)
    ok, reasons = rm.can_open_trade(sig,{"equity":10000,"free_margin":10000,"margin_level":9999},
        {"max_spread":0.001,"volume_min":0.01,"volume_max":100,"volume_step":0.01,"stops_level":0,"point":0.0001,
         "contract_size":100000,"point_value":1.0,"leverage":500},
        {"ask":1.1,"bid":1.0999,"time":datetime.now(timezone.utc)},{})
    assert not ok and any("Duplicate" in r for r in reasons)

def test_min_rr():
    rm = RiskManager(RiskSettings(min_rr=2.0))
    rm.update_equity(10000)
    sig = TradeSignal("EURUSD","M15","BUY","t",datetime.now(timezone.utc),1.1,1.099,1.101,80)
    ok, reasons = rm.can_open_trade(sig,{"equity":10000,"free_margin":10000,"margin_level":9999},
        {"max_spread":0.001,"volume_min":0.01,"volume_max":100,"volume_step":0.01,"stops_level":0,"point":0.0001,
         "contract_size":100000,"point_value":1.0,"leverage":500},
        {"ask":1.1,"bid":1.0999,"time":datetime.now(timezone.utc)},{})
    assert not ok and any("R:R" in r for r in reasons)

if __name__ == "__main__":
    tests = [f for n,f in list(globals().items()) if n.startswith("test_") and callable(f)]
    passed, failed = 0,0
    for t in tests:
        try: t(); print(f"PASS  {t.__name__}"); passed+=1
        except Exception as e: print(f"FAIL  {t.__name__}: {e}"); failed+=1
    print(f"\n{passed} passed, {failed} failed")
