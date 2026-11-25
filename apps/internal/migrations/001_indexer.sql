-- Tables the indexer fills from finalized chain events.
--
-- Every event row keeps its own transaction hash and log index, and those two are the primary
-- key, so replaying a range can never insert the same log twice.

-- One row per indexed contract. `id` is the lowercased contract address.
CREATE TABLE cursor (
  id text PRIMARY KEY,
  last_block bigint NOT NULL,
  last_block_hash text NOT NULL
);

CREATE TABLE events (
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  contract text NOT NULL,
  name text NOT NULL,
  args jsonb NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX events_block_number_idx ON events (block_number);
CREATE INDEX events_contract_name_idx ON events (contract, name);

-- A target is a contract or a skill bundle. `src` is the `?src=` reference and is null when a
-- skill was indexed before its GitHub source was known.
CREATE TABLE targets (
  target_id text PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('SMART_CONTRACT', 'AI_SKILL_BUNDLE')),
  label text NOT NULL,
  src text,
  codehash text,
  bundle_hash text,
  publisher text,
  publisher_role text NOT NULL DEFAULT 'NONE'
    CHECK (publisher_role IN ('NONE', 'THIRD_PARTY_SPONSOR', 'VERIFIED_PUBLISHER')),
  bond numeric NOT NULL DEFAULT 0,
  active_flags integer NOT NULL DEFAULT 0 CHECK (active_flags BETWEEN 0 AND 65535),
  -- Set when a jury confirmed the target is dangerous. The verdict that confirms it is the only
  -- one that adds its flags, so the indexer has to know whether it already happened.
  confirmed_danger boolean NOT NULL DEFAULT false,
  has_delegatecall boolean NOT NULL DEFAULT false,
  active_challenge_id text,
  safe_count integer NOT NULL DEFAULT 0 CHECK (safe_count >= 0),
  caution_count integer NOT NULL DEFAULT 0 CHECK (caution_count >= 0),
  danger_count integer NOT NULL DEFAULT 0 CHECK (danger_count >= 0),
  created_at_block bigint NOT NULL,
  last_vote_at timestamptz
);

CREATE INDEX targets_last_vote_at_idx ON targets (last_vote_at DESC NULLS LAST, target_id);

CREATE TABLE attestations (
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  target_id text NOT NULL REFERENCES targets (target_id),
  guardian text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('SAFE', 'CAUTION', 'DANGER')),
  flags integer NOT NULL CHECK (flags BETWEEN 0 AND 65535),
  weight integer NOT NULL CHECK (weight BETWEEN 0 AND 5),
  -- The place of this attestation among the target's attestations, and its place among the
  -- safe ones. The contract numbers them, and `AttestationSettled` names them.
  attestation_index integer NOT NULL CHECK (attestation_index >= 0),
  safe_ordinal integer NOT NULL CHECK (safe_ordinal >= 0),
  short_proof text NOT NULL,
  evidence_uri text NOT NULL,
  cast_during_dispute boolean NOT NULL DEFAULT false,
  settled boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX attestations_target_idx ON attestations (target_id, attestation_index);
CREATE INDEX attestations_guardian_idx ON attestations (guardian);

CREATE TABLE guardians (
  address text PRIMARY KEY,
  score integer NOT NULL DEFAULT 0,
  weight integer NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 5),
  attestations integer NOT NULL DEFAULT 0 CHECK (attestations >= 0),
  pending_penalties integer NOT NULL DEFAULT 0,
  created_at_block bigint NOT NULL
);

CREATE TABLE score_changes (
  guardian text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (guardian, tx_hash, log_index)
);

CREATE TABLE challenges (
  id text PRIMARY KEY,
  target_id text NOT NULL REFERENCES targets (target_id),
  label text NOT NULL,
  challenger text NOT NULL,
  phase text NOT NULL CHECK (phase IN ('COMMIT', 'REVEAL', 'AWAITING_CLOSE', 'CLOSED')),
  outcome text NOT NULL CHECK (outcome IN ('PENDING', 'UPHELD', 'REJECTED', 'TIED', 'EXPIRED')),
  flags integer NOT NULL DEFAULT 0 CHECK (flags BETWEEN 0 AND 65535),
  short_proof text NOT NULL DEFAULT '',
  evidence_uri text,
  counter_evidence_uri text,
  publisher text,
  commits integer NOT NULL DEFAULT 0 CHECK (commits >= 0),
  reveals integer NOT NULL DEFAULT 0 CHECK (reveals >= 0),
  commit_ends_at timestamptz,
  reveal_ends_at timestamptz,
  created_at_block bigint NOT NULL
);

CREATE INDEX challenges_target_idx ON challenges (target_id);

CREATE TABLE jurors (
  challenge_id text NOT NULL REFERENCES challenges (id),
  address text NOT NULL,
  weight integer NOT NULL CHECK (weight BETWEEN 0 AND 5),
  commit_hash text NOT NULL,
  revealed boolean NOT NULL DEFAULT false,
  uphold boolean,
  at timestamptz NOT NULL,
  PRIMARY KEY (challenge_id, address)
);

CREATE TABLE bonds (
  target_id text NOT NULL REFERENCES targets (target_id),
  depositor text NOT NULL,
  amount numeric NOT NULL,
  requested_at timestamptz,
  withdrawable_at timestamptz,
  finalized_at timestamptz,
  locked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (target_id, depositor)
);

CREATE TABLE bounties (
  id text PRIMARY KEY,
  target_id text NOT NULL REFERENCES targets (target_id),
  label text NOT NULL,
  requester text NOT NULL,
  slots integer NOT NULL CHECK (slots BETWEEN 3 AND 5),
  amount numeric NOT NULL,
  created_at timestamptz NOT NULL,
  settleable_at timestamptz,
  settled boolean NOT NULL DEFAULT false
);

-- One row per filled slot. The requester never fills a slot of their own bounty.
CREATE TABLE bounty_fillers (
  bounty_id text NOT NULL REFERENCES bounties (id),
  guardian text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('SAFE', 'CAUTION', 'DANGER')),
  at timestamptz NOT NULL,
  PRIMARY KEY (bounty_id, guardian)
);

-- The balance ledger. `kind` is CREDIT or WITHDRAW, so a balance is the sum over its rows.
CREATE TABLE balances (
  address text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CREDIT', 'WITHDRAW')),
  amount numeric NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (address, tx_hash, log_index)
);
