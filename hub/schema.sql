-- Pascual Hub — D1 schema
-- Apply with: npx wrangler d1 execute pascual-hub --file=schema.sql

CREATE TABLE IF NOT EXISTS profiles (
  address    TEXT PRIMARY KEY,       -- lowercase 0x wallet
  created_at INTEGER NOT NULL,
  handle     TEXT                    -- optional display name, set later
);

CREATE TABLE IF NOT EXISTS watchlist (
  owner    TEXT NOT NULL,            -- profile address that owns this entry
  wallet   TEXT NOT NULL,            -- watched wallet (lowercase 0x)
  label    TEXT,                     -- user's note
  added_at INTEGER NOT NULL,
  PRIMARY KEY (owner, wallet)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_owner ON watchlist(owner);

-- X Cockpit: analyses pushed from the browser extension (Analyze / Sentiment /
-- Improve). Content is the COMPUTED result, never raw third-party tweets in bulk.
CREATE TABLE IF NOT EXISTS x_items (
  id       TEXT PRIMARY KEY,        -- client-generated uuid (idempotent inserts)
  owner    TEXT NOT NULL,           -- profile address that owns this item
  kind     TEXT NOT NULL,           -- 'analyze' | 'sentiment' | 'improve'
  subject  TEXT,                    -- short label: author handle / post snippet
  result   TEXT NOT NULL,           -- the analysis text
  url      TEXT,                    -- link to the source post (optional)
  job_hash TEXT,                    -- keccak256(result): ERC-8183 deliverable hash
  anchored_job INTEGER,             -- ERC-8183 job_id once anchored on-chain (NULL = not yet)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xitems_owner ON x_items(owner, created_at);

-- Device links for the extension: cid -> wallet address (set after the user
-- signs a link message on the hub site). Mirrors the credits-link pattern.
CREATE TABLE IF NOT EXISTS ext_links (
  cid      TEXT PRIMARY KEY,
  address  TEXT NOT NULL,
  linked_at INTEGER NOT NULL
);
