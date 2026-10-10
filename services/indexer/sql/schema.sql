CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS protocol_events (
  signature TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  slot BIGINT NOT NULL,
  block_time BIGINT,
  event_name TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (signature, event_index)
);
CREATE INDEX IF NOT EXISTS protocol_events_slot_idx ON protocol_events(slot DESC);
CREATE INDEX IF NOT EXISTS protocol_events_name_idx ON protocol_events(event_name, slot DESC);

CREATE TABLE IF NOT EXISTS families (
  root_mint TEXT PRIMARY KEY,
  family_address TEXT NOT NULL,
  descendant_count INTEGER NOT NULL DEFAULT 0,
  created_slot BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS lineages (
  mint TEXT PRIMARY KEY,
  root_mint TEXT NOT NULL,
  parent_mint TEXT,
  creator TEXT NOT NULL,
  generation SMALLINT NOT NULL,
  status TEXT NOT NULL,
  self_root_mass NUMERIC(39, 0) NOT NULL,
  direct_children_count SMALLINT NOT NULL DEFAULT 0,
  active_candidate TEXT,
  launch_pool TEXT,
  cpmm_pool TEXT,
  reserve_claimed BOOLEAN NOT NULL DEFAULT false,
  created_slot BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS lineages_root_idx ON lineages(root_mint);
CREATE INDEX IF NOT EXISTS lineages_parent_idx ON lineages(parent_mint);
CREATE TABLE IF NOT EXISTS epochs (
  address TEXT PRIMARY KEY,
  parent_mint TEXT NOT NULL,
  epoch_id NUMERIC(20, 0) NOT NULL,
  proposal_end BIGINT NOT NULL,
  vote_end BIGINT NOT NULL,
  status TEXT NOT NULL,
  winning_child_mint TEXT,
  support NUMERIC(20, 0),
  created_slot BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  address TEXT PRIMARY KEY,
  epoch TEXT NOT NULL,
  child_mint TEXT NOT NULL,
  proposal_id SMALLINT NOT NULL,
  proposer TEXT,
  support NUMERIC(20, 0) NOT NULL DEFAULT 0,
  metadata_hash TEXT,
  created_slot BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  epoch TEXT NOT NULL,
  voter TEXT NOT NULL,
  proposal TEXT NOT NULL,
  amount NUMERIC(20, 0) NOT NULL,
  signature TEXT NOT NULL,
  PRIMARY KEY (epoch, voter)
);
CREATE TABLE IF NOT EXISTS candidates (
  child_mint TEXT PRIMARY KEY,
  parent_mint TEXT NOT NULL,
  status TEXT NOT NULL,
  launch_deadline BIGINT,
  migration_deadline BIGINT,
  launch_pool TEXT,
  cpmm_pool TEXT,
  reserve_claimed BOOLEAN NOT NULL DEFAULT false,
  settled BOOLEAN NOT NULL DEFAULT false,
  last_slot BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS mutations (
  signature TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  parent_mint TEXT NOT NULL,
  child_mint TEXT NOT NULL,
  burned NUMERIC(20, 0) NOT NULL,
  root_mass_transferred NUMERIC(39, 0) NOT NULL,
  parent_supply_after NUMERIC(20, 0) NOT NULL,
  generation SMALLINT NOT NULL,
  slot BIGINT NOT NULL,
  PRIMARY KEY (signature, event_index)
);
