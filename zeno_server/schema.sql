CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT        UNIQUE NOT NULL,
    email         TEXT        UNIQUE NOT NULL,
    name          TEXT,
    password_hash TEXT,
    google_id     TEXT        UNIQUE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    last_login    TIMESTAMPTZ DEFAULT NOW(),
    query_count   INTEGER     DEFAULT 0
);

CREATE TABLE IF NOT EXISTS videos (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id    TEXT        NOT NULL,
    title       TEXT,
    channel     TEXT,
    thumbnail   TEXT,
    chunk_count INTEGER     DEFAULT 0,
    status      TEXT        DEFAULT 'processing',
    error_msg   TEXT,
    indexed_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, video_id)
);

CREATE TABLE IF NOT EXISTS query_history (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id      TEXT,
    query         TEXT        NOT NULL,
    answer        TEXT,
    sources_count INTEGER     DEFAULT 0,
    mode          TEXT        DEFAULT 'chain',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_videos_user_id      ON videos       (user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status       ON videos       (status);
CREATE INDEX IF NOT EXISTS idx_query_history_user  ON query_history(user_id);
CREATE INDEX IF NOT EXISTS idx_query_history_video ON query_history(video_id);