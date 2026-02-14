-- The Button D1 Database Schema

-- Game rounds table
CREATE TABLE IF NOT EXISTS game_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_number INTEGER UNIQUE NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    winner TEXT,
    total_pot REAL DEFAULT 0,
    total_presses INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'finished'))
);

-- Players table
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    wallet_address TEXT,
    total_presses INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    total_won REAL DEFAULT 0,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
);

-- Presses table - tracks every button press
CREATE TABLE IF NOT EXISTS presses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    press_time INTEGER NOT NULL,
    timer_at REAL NOT NULL,
    payment_txid TEXT,
    payment_amount REAL DEFAULT 0,
    color TEXT NOT NULL,
    flair TEXT NOT NULL,
    FOREIGN KEY (round_id) REFERENCES game_rounds(id),
    FOREIGN KEY (player_name) REFERENCES players(name)
);

-- Current game state table - single row for current game
CREATE TABLE IF NOT EXISTS game_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_round INTEGER NOT NULL,
    timer REAL NOT NULL DEFAULT 60,
    last_press_time INTEGER,
    last_presser TEXT,
    started BOOLEAN DEFAULT FALSE,
    game_over BOOLEAN DEFAULT FALSE,
    pot REAL DEFAULT 0,
    press_count INTEGER DEFAULT 0
);

-- Initialize with first round
INSERT OR IGNORE INTO game_rounds (round_number, start_time, status) VALUES (1, unixepoch() * 1000, 'active');
INSERT OR IGNORE INTO game_state (id, current_round, timer, started, game_over, pot, press_count) VALUES (1, 1, 60, FALSE, FALSE, 0, 0);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_presses_round_time ON presses(round_id, press_time DESC);
CREATE INDEX IF NOT EXISTS idx_presses_player ON presses(player_name);
CREATE INDEX IF NOT EXISTS idx_players_total_presses ON players(total_presses DESC);
CREATE INDEX IF NOT EXISTS idx_players_total_won ON players(total_won DESC);