-- A bounty can be asked for before Core has recorded its target. Vault.createBounty reads
-- getTarget(targetId).attestationCount, which is 0 for a target that does not exist yet, so a
-- bounty on a brand-new contract is a normal flow: the requester asks for the first attestations.
--
-- The indexer used to stop for good on such a bounty, because the row of the target was missing.
-- The bounty is now stored without it. The label is filled when TargetCreated arrives, and the
-- read model falls back to the target id until then.
--
-- The file was called 005_bounty_before_target.sql before it was renamed, so a database that ran
-- the old name runs this one as well. Every statement is written so that it can run twice.
ALTER TABLE bounties DROP CONSTRAINT IF EXISTS bounties_target_id_fkey;
ALTER TABLE bounties ALTER COLUMN label DROP NOT NULL;
