-- The rows the Court and the Vault bring, on top of the first migration. Every change is
-- additive, so a database that already ran 001 to 003 keeps its rows.

-- The commit hash is not part of the VoteCommitted event: the contract keeps it and the indexer
-- never sees it. The column is therefore empty, and it stays empty.
ALTER TABLE jurors ALTER COLUMN commit_hash DROP NOT NULL;

-- The weight on each side of a verdict.
ALTER TABLE challenges ADD COLUMN uphold_weight integer NOT NULL DEFAULT 0 CHECK (uphold_weight >= 0);
ALTER TABLE challenges ADD COLUMN reject_weight integer NOT NULL DEFAULT 0 CHECK (reject_weight >= 0);

-- The place of the first attestation that may fill a slot of a bounty. The slots of a bounty
-- fill from the attestations that come after the bounty was created.
ALTER TABLE bounties ADD COLUMN start_index integer NOT NULL DEFAULT 0 CHECK (start_index >= 0);

-- The challenge a bond is locked by. A locked bond cannot be withdrawn.
ALTER TABLE bonds ADD COLUMN locked_by_challenge_id text;

-- The XP an attestation earned when it settled. It is null until the settlement happens.
ALTER TABLE attestations ADD COLUMN settled_xp integer;

-- The moment a dispute was opened and the moment a bond was deposited. The events that carry
-- them have a timestamp, so the rows keep it and the history of an account can be ordered by it.
ALTER TABLE challenges ADD COLUMN created_at timestamptz;
ALTER TABLE bonds ADD COLUMN created_at timestamptz;

-- The target a score change belongs to.
ALTER TABLE score_changes ADD COLUMN target_id text;

-- The payouts of a challenge. The rows hold the payouts of that challenge alone, so a challenge
-- never shows the money of another one.
CREATE TABLE payouts (
  challenge_id text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  recipient text NOT NULL,
  amount numeric NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX payouts_challenge_idx ON payouts (challenge_id);

-- What the escrow of a challenge holds. Every movement is a row of its own, so the escrow is
-- the sum over the rows of that challenge and a range that is read twice counts nothing twice.
CREATE TABLE escrow_movements (
  challenge_id text NOT NULL,
  tx_hash text NOT NULL,
  log_index integer NOT NULL,
  delta numeric NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE INDEX escrow_movements_challenge_idx ON escrow_movements (challenge_id);
