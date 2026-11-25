-- Guards added after the second review of the operational tables. Every change is additive, so a
-- database that already ran 001, 002 and 003 keeps its rows.

-- The status of a row is the status of the result it holds, so the two can never tell different
-- stories. A result without a readable status is INCOMPLETE, because an unknown result is never a
-- clean one.
ALTER TABLE sandbox_cache ADD CONSTRAINT sandbox_cache_status_matches_result_check
  CHECK (status = COALESCE(result ->> 'status', 'INCOMPLETE'));

-- A failed result stays what it is: the same bundle, the same result, the same status. A later run
-- that would store a clean result under a failed row is refused.
CREATE OR REPLACE FUNCTION sandbox_cache_keeps_failure() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'SANDBOX_FUZZ_FAILED' THEN
      RAISE EXCEPTION 'a failed sandbox result is kept forever';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'SANDBOX_FUZZ_FAILED' THEN
    IF NEW.status <> 'SANDBOX_FUZZ_FAILED' THEN
      RAISE EXCEPTION 'a failed sandbox result is kept forever';
    END IF;
    IF NEW.result IS DISTINCT FROM OLD.result OR NEW.bundle_hash IS DISTINCT FROM OLD.bundle_hash THEN
      RAISE EXCEPTION 'a failed sandbox result is never rewritten';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The rate rows that were counted before the window length was kept have no window of their own.
-- They are counters, so they are dropped and the window length becomes a rule.
DELETE FROM rate WHERE window_seconds = 0;

ALTER TABLE rate ADD CONSTRAINT rate_window_seconds_check CHECK (window_seconds > 0);
