// ============================================
// ASSET DETECTOR — Auto-detect class from symbol
// ============================================

const AssetDetector = {
  // Normalize a raw broker symbol (strip suffixes/prefixes, lowercase→uppercase)
  normalize(raw) {
    if (!raw) return '';
    let s = String(raw).toUpperCase().trim();
    // Remove common broker suffixes/prefixes
    s = s.replace(/[._\-](M|MICRO|MINI|STP|ECN|PRO|RAW|STANDARD|A|B|C|R|I|Z|STD|CENTS)$/g, '');
    s = s.replace(/^(LIVE|DEMO|REAL|FX|XAU|XBT)[._\-]/g, '');
    s = s.replace(/[._\-]+/g, '');
    return s;
  },

  // Detect asset class of a normalized symbol
  detectClass(rawSymbol) {
    const s = this.normalize(rawSymbol);

    // GOLD
    if (/^(XAUUSD|XAUEUR|GOLD|XAU)/.test(s)) return 'GOLD';

    // CRYPTO — majors, then general patterns
    const cryptoMajors = ['BTCUSD','ETHUSD','XRPUSD','LTCUSD','BCHUSD','ADAUSD',
                          'DOGEUSD','SOLUSD','DOTUSD','AVAXUSD','MATICUSD','LINKUSD',
                          'UNIUSD','ATOMUSD','XLMUSD','TRXUSD','BNBUSD'];
    if (cryptoMajors.includes(s)) return 'CRYPTO';
    if (/^BTC|^ETH|^XRP|^LTC|^BCH|^DOGE|^SOL|^ADA|^DOT|^AVAX|^MATIC|^LINK|^UNI|^ATOM|^XLM|^TRX|^BNB/.test(s)) return 'CRYPTO';
    if (/USD$/.test(s) && !/^(EUR|GBP|USD|JPY|AUD|NZD|CAD|CHF)/.test(s) && s.length >= 6 && s.length <= 8) {
      // Could be crypto if not FX pattern — check further
      const fxBase = ['EUR','GBP','USD','JPY','AUD','NZD','CAD','CHF','NOK','SEK','DKK','SGD','HKD','ZAR','TRY','MXN','PLN','CZK','HUF','RON'];
      const base3 = s.substring(0,3);
      const quote3 = s.substring(3,6);
      if (!fxBase.includes(base3) && !fxBase.includes(quote3) && s.length === 6) {
        return 'CRYPTO';
      }
    }
    // Also BTC/ETH pairs with other quotes
    if (/^(BTC|ETH)(EUR|USDT|USDC|BUSD)$/.test(s)) return 'CRYPTO';

    // INDICES
    const indices = ['US30','NAS100','SPX500','SP500','UK100','GER30','DAX30','FRA40',
                     'JP225','AUS200','ESTX50','EU50','HK50','CHN50','DOW','NDX','SPX',
                     'DJI','IXIC','FTSE','NQ','YM','ES','RUT','RUSSELL2000'];
    for (const idx of indices) if (s.includes(idx)) return 'INDEX';
    if (/^(US|NAS|SPX|UK|GER|DAX|FRA|JP|AUS|HK|CHN|ES|NQ|YM|RTY)\d*/.test(s)) return 'INDEX';
    if (/30$|100$|500$|225$|40$|50$/.test(s) && s.length <= 8) return 'INDEX';

    // FOREX — 6-letter majors/minors/crosses
    const fxBase = ['EUR','GBP','USD','AUD','NZD','CAD','CHF','JPY','NOK','SEK','DKK','SGD','HKD','ZAR','TRY','MXN','PLN','CZK','HUF'];
    if (s.length === 6) {
      const base3 = s.substring(0,3);
      const quote3 = s.substring(3,6);
      if (fxBase.includes(base3) && fxBase.includes(quote3)) return 'FOREX';
    }
    // Synthetic indices / broker-specific
    if (/^VOL/.test(s)) return 'INDEX';

    // Default heuristic
    if (s.includes('USD') && s.length === 6) return 'FOREX';
    return 'FOREX';
  },

  // Return profile for a raw symbol (with overrides applied)
  getProfile(rawSymbol) {
    const normalized = this.normalize(rawSymbol);
    const assetClass = this.detectClass(rawSymbol);
    const base = ASSET_PROFILES[assetClass];
    const override = SYMBOL_OVERRIDES[normalized] || {};
    // Deep merge
    return { ...base, ...override, assetClass, normalized, raw: rawSymbol };
  },

  // Human-readable pair name
  displayName(rawSymbol) {
    const n = this.normalize(rawSymbol);
    const names = {
      EURUSD: 'EUR / USD', GBPUSD: 'GBP / USD', USDJPY: 'USD / JPY',
      AUDUSD: 'AUD / USD', USDCAD: 'USD / CAD', USDCHF: 'USD / CHF',
      NZDUSD: 'NZD / USD', EURGBP: 'EUR / GBP', EURJPY: 'EUR / JPY',
      GBPJPY: 'GBP / JPY', XAUUSD: 'Gold vs USD',
      BTCUSD: 'Bitcoin', ETHUSD: 'Ethereum',
      US30: 'Wall Street 30', NAS100: 'Nasdaq 100', SPX500: 'S&P 500',
      UK100: 'FTSE 100', GER30: 'DAX 40',
    };
    return names[n] || n;
  }
};
