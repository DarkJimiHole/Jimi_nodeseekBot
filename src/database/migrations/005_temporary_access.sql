CREATE TABLE IF NOT EXISTS temporary_access_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'quick',
    public_url TEXT NOT NULL DEFAULT '',
    tunnel_token TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL DEFAULT 5
);
INSERT OR IGNORE INTO temporary_access_config (id) VALUES (1);
