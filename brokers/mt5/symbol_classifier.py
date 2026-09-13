"""
Classify a broker symbol into FOREX / GOLD / CRYPTO / INDEX.
Shared by MT5Local and MetaApi adapters.
"""

def classify(symbol: str) -> str:
    # Reuse the asset detector if available (frontend-facing), but keep a
    # standalone copy so the backend adapters don't depend on frontend code.
    s = (symbol or "").upper().strip()
    # Strip common broker suffixes/prefixes
    for suf in ("m","a","r","ecn","pro","raw","std","i","mini","micro"):
        if s.endswith(suf) and len(s) > len(suf)+2:
            # Check if remaining base is recognizable
            base = s[:-len(suf)]
            if _looks_like_any(base):
                s = base; break
    # Special cases
    if s.startswith("XAU") or s == "GOLD": return "GOLD"
    # Crypto
    if s.startswith("BTC") or s.startswith("ETH") or s.startswith("XRP") or s.startswith("LTC") \
       or s.startswith("BCH") or s.startswith("DOGE") or s.startswith("SOL") or s.startswith("ADA") \
       or s.startswith("BNB") or s.endswith("USDT") or s.endswith("BUSD") or s.endswith("USDC"):
        return "CRYPTO"
    # Indices
    for pat in ("US30","NAS100","SPX","SP500","UK100","GER30","DAX","FRA40","JP225","AUS200",
                "HK50","CHN50","DJI","NDX","ES","NQ","YM","RTY","USTEC","US500","NAS"):
        if pat in s: return "INDEX"
    # Forex: 6-letter pairs
    if len(s) == 6 and s[-3:] in ("USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF","NOK","SEK","DKK","SGD","HKD","ZAR","TRY","MXN","PLN","CZK","HUF","RON"):
        return "FOREX"
    if len(s) == 6 and s[:3] in ("EUR","GBP","USD","AUD","NZD","CAD","CHF","JPY","NOK","SEK","DKK","SGD","HKD","ZAR","TRY","MXN","PLN","CZK","HUF"):
        return "FOREX"
    return "FOREX"

def _looks_like_any(base):
    return classify(base) != "FOREX" or len(base)==6
