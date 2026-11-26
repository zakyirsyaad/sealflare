-- The moment the verdict that confirmed a target as dangerous was applied, and how many votes the
-- target held then. CoreSettlement pays XP for a DANGER vote only when it was cast before that
-- verdict (its index is below the count at the verdict) and outside a dispute, so the read model
-- needs both to tell which DANGER votes have XP to claim.
--
-- A target that was confirmed before this migration has neither, and the read model then offers
-- no claim for it instead of guessing. The indexer fills them when it reads the verdict again:
-- the moment from the block the verdict was mined in and the count from the votes in the raw log.
-- Reading the chain again from the start block does that, because the verdict is read a second
-- time and the handler that wrote the columns is skipped.
--
-- The file was called 006_verdict_moment.sql before it was renamed, so a database that ran the
-- old name runs this one as well. Every statement is written so that it can run twice.
ALTER TABLE targets ADD COLUMN IF NOT EXISTS count_at_verdict integer CHECK (count_at_verdict >= 0);
ALTER TABLE targets ADD COLUMN IF NOT EXISTS verdict_at timestamptz;
