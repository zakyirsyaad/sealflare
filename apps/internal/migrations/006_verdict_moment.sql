-- The moment the verdict that confirmed a target as dangerous was applied, and how many votes the
-- target held then. CoreSettlement pays XP for a DANGER vote only when it was cast before that
-- verdict (its index is below the count at the verdict) and outside a dispute, so the read model
-- needs both to tell which DANGER votes have XP to claim.
--
-- A target that was confirmed before this migration has neither, and the read model then offers
-- no claim for it instead of guessing. Reading the chain again from the start block fills them.
ALTER TABLE targets ADD COLUMN count_at_verdict integer CHECK (count_at_verdict >= 0);
ALTER TABLE targets ADD COLUMN verdict_at timestamptz;
