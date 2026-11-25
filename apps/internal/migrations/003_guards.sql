-- Guards added after the first review of the operational tables. Every change is additive, so a
-- database that already ran 001 and 002 keeps its rows.

-- The cached sandbox result carries its own status, so a permanent failure is told apart from a
-- clean result that only matches while the probe set version and the model are the same.
ALTER TABLE sandbox_cache ADD COLUMN status text;

-- A row that was stored before the column existed keeps the status its result carries. A result
-- whose status cannot be read is INCOMPLETE, because an unknown result is never a clean one.
UPDATE sandbox_cache SET status = COALESCE(result ->> 'status', 'INCOMPLETE');

ALTER TABLE sandbox_cache ALTER COLUMN status SET NOT NULL;

ALTER TABLE sandbox_cache ADD CONSTRAINT sandbox_cache_status_check
  CHECK (status IN ('NO_VIOLATION_OBSERVED', 'SANDBOX_FUZZ_FAILED', 'INCOMPLETE'));

-- A failure is kept forever, so it is found by the bundle alone, whatever probe set version or
-- model produced it.
CREATE INDEX sandbox_cache_failed_idx ON sandbox_cache (bundle_hash)
  WHERE status = 'SANDBOX_FUZZ_FAILED';

-- A failed result never becomes a clean one and is never removed: a skill cannot erase its trace
-- by failing the run after it violated.
CREATE FUNCTION sandbox_cache_keeps_failure() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'SANDBOX_FUZZ_FAILED' THEN
      RAISE EXCEPTION 'a failed sandbox result is kept forever';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'SANDBOX_FUZZ_FAILED' AND NEW.status <> 'SANDBOX_FUZZ_FAILED' THEN
    RAISE EXCEPTION 'a failed sandbox result is kept forever';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sandbox_cache_keeps_failure
  BEFORE UPDATE OR DELETE ON sandbox_cache
  FOR EACH ROW EXECUTE FUNCTION sandbox_cache_keeps_failure();

-- The run status is a closed list, like every other enum column of the schema.
ALTER TABLE sandbox_runs ADD CONSTRAINT sandbox_runs_status_check
  CHECK (status IN ('queued', 'running', 'done', 'incomplete'));

-- Only an infrastructure failure gives the quota back, so a typo here would cost a user a slot
-- for an outage of our own.
ALTER TABLE sandbox_runs ADD CONSTRAINT sandbox_runs_failure_cause_check
  CHECK (failure_cause IS NULL OR failure_cause IN ('infrastructure', 'skill_content'));

-- An address has five sandbox runs a day, the same number as CONSTANTS.SANDBOX_DAILY_RUNS in
-- shared/rules/constants.ts. The check keeps two concurrent runs from handing out a sixth slot.
ALTER TABLE sandbox_quota DROP CONSTRAINT sandbox_quota_used_check;
ALTER TABLE sandbox_quota ADD CONSTRAINT sandbox_quota_used_check CHECK (used >= 0 AND used <= 5);

-- Two limits on the same key with a different window length have their own count, so one limit
-- cannot refuse the requests of the other.
ALTER TABLE rate ADD COLUMN window_seconds integer NOT NULL DEFAULT 0;
-- The default only fills rows that already exist. A caller that forgets the window is refused
-- instead of landing in a shared counter.
ALTER TABLE rate ALTER COLUMN window_seconds DROP DEFAULT;
ALTER TABLE rate DROP CONSTRAINT rate_pkey;
ALTER TABLE rate ADD PRIMARY KEY (key, window_start, window_seconds);
