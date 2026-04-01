import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'toll_enforcement.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS toll_segments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            booth_a_name TEXT NOT NULL,
            booth_a_location TEXT,
            booth_b_name TEXT NOT NULL,
            booth_b_location TEXT,
            distance_miles REAL NOT NULL,
            speed_limit_mph INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS toll_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_plate TEXT NOT NULL,
            vehicle_class TEXT,
            transponder_id TEXT,
            booth_id INTEGER NOT NULL,
            booth_name TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            amount_charged REAL,
            payment_method TEXT,
            image_url TEXT,
            processed INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS vehicle_owners (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_plate TEXT NOT NULL UNIQUE,
            transponder_id TEXT,
            owner_name TEXT NOT NULL,
            owner_email TEXT NOT NULL,
            address TEXT,
            vehicle_make TEXT,
            vehicle_model TEXT,
            vehicle_year INTEGER
        );

        CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_plate TEXT NOT NULL,
            segment_id INTEGER NOT NULL,
            entry_booth TEXT NOT NULL,
            exit_booth TEXT NOT NULL,
            entry_time TEXT NOT NULL,
            exit_time TEXT NOT NULL,
            calculated_speed_mph REAL NOT NULL,
            speed_limit_mph INTEGER NOT NULL,
            leniency_mph INTEGER NOT NULL,
            over_limit_mph REAL NOT NULL,
            owner_name TEXT,
            owner_email TEXT,
            status TEXT NOT NULL DEFAULT 'issued',
            suppression_reason TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (segment_id) REFERENCES toll_segments(id)
        );

        CREATE TABLE IF NOT EXISTS email_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            violation_id INTEGER NOT NULL,
            recipient_email TEXT NOT NULL,
            recipient_name TEXT,
            subject TEXT NOT NULL,
            body TEXT NOT NULL,
            simulated_sent_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (violation_id) REFERENCES violations(id)
        );

        CREATE TABLE IF NOT EXISTS officer_citations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_plate TEXT NOT NULL,
            segment_id INTEGER NOT NULL,
            officer_name TEXT,
            officer_badge TEXT,
            citation_time TEXT NOT NULL,
            speed_recorded REAL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (segment_id) REFERENCES toll_segments(id)
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_plate ON toll_transactions(license_plate);
        CREATE INDEX IF NOT EXISTS idx_transactions_booth ON toll_transactions(booth_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON toll_transactions(timestamp);
        CREATE INDEX IF NOT EXISTS idx_transactions_processed ON toll_transactions(processed);
        CREATE INDEX IF NOT EXISTS idx_violations_plate ON violations(license_plate);
        CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status);
        CREATE INDEX IF NOT EXISTS idx_violations_created ON violations(created_at);
        CREATE INDEX IF NOT EXISTS idx_officer_citations_plate ON officer_citations(license_plate);
        CREATE INDEX IF NOT EXISTS idx_officer_citations_segment ON officer_citations(segment_id);
        CREATE INDEX IF NOT EXISTS idx_officer_citations_time ON officer_citations(citation_time);
    ''')

    # Insert default settings if not present
    defaults = {
        'leniency_mph': '10',
        'dedup_window_minutes': '60',
        'system_enabled': '1',
    }
    for key, value in defaults.items():
        conn.execute(
            'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
            (key, value)
        )
    conn.commit()
    conn.close()


def get_setting(key):
    conn = get_db()
    row = conn.execute('SELECT value FROM settings WHERE key = ?', (key,)).fetchone()
    conn.close()
    return row['value'] if row else None


def set_setting(key, value):
    conn = get_db()
    conn.execute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        (key, str(value))
    )
    conn.commit()
    conn.close()
