-- Tables the internal service owns for itself: cached scans, rate limits, and one-use nonces.

-- The last scan of a target, so the target page can be opened again without scanning again.
CREATE TABLE scan_cache (
  target_id text PRIMARY KEY,
  src text,
  report jsonb NOT NULL,
  scanned_at timestamptz NOT NULL
);

-- One row per key and window. The key is a hash the caller computed; a raw address never
-- reaches this table.
CREATE TABLE rate (
  key text NOT NULL,
  window_start bigint NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- Signed request nonces. A nonce is reserved before the work behind it starts and spent when
-- the work is done, so a failed request can give the reservation back but a used nonce stays
-- used until it expires.
CREATE TABLE nonces (
  address text NOT NULL,
  nonce numeric NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'spent')),
  PRIMARY KEY (address, nonce)
);

CREATE INDEX nonces_expires_at_idx ON nonces (expires_at);

CREATE TABLE sandbox_runs (
  run_id text PRIMARY KEY,
  address text NOT NULL,
  bundle_hash text NOT NULL,
  probe_set_version text NOT NULL,
  model_id text NOT NULL,
  status text NOT NULL,
  queue_position integer,
  current_probe text,
  result jsonb,
  evidence_uri text,
  failure_cause text,
  failure_message text,
  quota_refunded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz
);

-- A cached sandbox result. A failed result is kept forever; a clean one only matches while the
-- probe set version and the model are the same.
CREATE TABLE sandbox_cache (
  bundle_hash text NOT NULL,
  probe_set_version text NOT NULL,
  model_id text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (bundle_hash, probe_set_version, model_id)
);

CREATE TABLE sandbox_quota (
  address text NOT NULL,
  day date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (address, day)
);
