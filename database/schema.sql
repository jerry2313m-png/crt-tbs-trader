-- ============================================================
-- CRT+TBS Trading Platform — PostgreSQL Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    twofa_secret    VARCHAR(64),
    twofa_enabled   BOOLEAN DEFAULT FALSE,
    role            VARCHAR(16) DEFAULT 'trader',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE broker_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    broker_type     VARCHAR(32) NOT NULL,       -- mt5 | ctrader | binance | coinbase
    label           VARCHAR(64),
    credentials_enc BYTEA,                      -- Fernet-encrypted JSON blob
    account_type    VARCHAR(8) DEFAULT 'demo',  -- demo | live
    status          VARCHAR(16) DEFAULT 'disconnected',
    last_connected  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE asset_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    asset_class     VARCHAR(16) NOT NULL,        -- FOREX | GOLD | CRYPTO | INDEX
    symbol          VARCHAR(24),                 -- null = applies to whole class
    settings        JSONB NOT NULL,              -- SL/TP multipliers, score, RR, TFs, sessions
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, asset_class, symbol)
);

CREATE TABLE trading_settings (
    user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    risk_per_trade      REAL DEFAULT 0.005,
    max_daily_loss      REAL DEFAULT 0.02,
    max_weekly_loss     REAL DEFAULT 0.05,
    max_drawdown        REAL DEFAULT 0.10,
    max_consec_losses   INT  DEFAULT 3,
    max_open_positions  INT  DEFAULT 3,
    max_trades_per_day  INT  DEFAULT 10,
    max_exposure        REAL DEFAULT 0.10,
    min_margin_level    REAL DEFAULT 150,
    min_rr              REAL DEFAULT 2.0,
    min_score           INT  DEFAULT 75,
    small_account_mode  BOOLEAN DEFAULT FALSE,
    partial_tp          BOOLEAN DEFAULT TRUE,
    break_even          BOOLEAN DEFAULT TRUE,
    trailing_stop       BOOLEAN DEFAULT TRUE,
    news_filter         VARCHAR(8) DEFAULT 'high',
    stop_at_target      BOOLEAN DEFAULT TRUE,
    daily_target_pct    REAL DEFAULT 3.0,
    trading_mode        VARCHAR(12) DEFAULT 'auto',
    emergency_state     BOOLEAN DEFAULT FALSE
);

CREATE TABLE signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_uid      VARCHAR(32) UNIQUE NOT NULL, -- deterministic TradeSignalID
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    symbol          VARCHAR(24) NOT NULL,
    timeframe       VARCHAR(8) NOT NULL,
    direction       VARCHAR(4) NOT NULL,
    setup           TEXT,
    entry           DOUBLE PRECISION,
    sl              DOUBLE PRECISION,
    tp              DOUBLE PRECISION,
    score           INT,
    candle_time     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON signals(user_id, symbol, created_at DESC);

CREATE TABLE orders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    broker_conn_id  UUID REFERENCES broker_connections(id),
    broker_ticket   BIGINT,
    signal_id       UUID REFERENCES signals(id),
    symbol          VARCHAR(24) NOT NULL,
    side            VARCHAR(4) NOT NULL,
    order_type      VARCHAR(12) NOT NULL,
    volume          DOUBLE PRECISION,
    price           DOUBLE PRECISION,
    stop_price      DOUBLE PRECISION,
    sl              DOUBLE PRECISION,
    tp              DOUBLE PRECISION,
    status          VARCHAR(16) NOT NULL,
    comment         VARCHAR(32),
    requested_at    TIMESTAMPTZ DEFAULT NOW(),
    filled_at       TIMESTAMPTZ
);

CREATE TABLE positions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    broker_conn_id  UUID REFERENCES broker_connections(id),
    order_id        UUID REFERENCES orders(id),
    broker_ticket   BIGINT,
    symbol          VARCHAR(24) NOT NULL,
    side            VARCHAR(4) NOT NULL,
    volume          DOUBLE PRECISION,
    entry_price     DOUBLE PRECISION,
    sl              DOUBLE PRECISION,
    tp              DOUBLE PRECISION,
    opened_at       TIMESTAMPTZ DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,
    close_price     DOUBLE PRECISION,
    pnl             DOUBLE PRECISION,
    close_reason    VARCHAR(24)
);

CREATE TABLE trade_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_id     UUID REFERENCES positions(id) ON DELETE CASCADE,
    exit_phase      VARCHAR(8),     -- TP1 | TP2 | TP3 | SL | BE | TRAIL | MANUAL
    exit_price      DOUBLE PRECISION,
    volume_closed   DOUBLE PRECISION,
    pnl             DOUBLE PRECISION,
    exited_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE risk_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    type            VARCHAR(32) NOT NULL,
    details         JSONB,
    triggered_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE system_events (
    id              BIGSERIAL PRIMARY KEY,
    level           VARCHAR(8) NOT NULL,     -- info | warn | error
    component       VARCHAR(24),
    event           VARCHAR(64) NOT NULL,
    details         JSONB,
    occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE performance_statistics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    symbol          VARCHAR(24),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    trades          INT,
    wins            INT,
    losses          INT,
    win_rate        REAL,
    profit_factor   REAL,
    avg_rr          REAL,
    total_pnl       DOUBLE PRECISION,
    max_drawdown    REAL,
    best_session    VARCHAR(16),
    worst_session   VARCHAR(16),
    best_setup      TEXT,
    worst_setup     TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, symbol, period_start, period_end)
);
