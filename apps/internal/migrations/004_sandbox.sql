-- The sandbox queue needs to remember what it was asked to run, what it has already seen, and
-- which day the quota was taken on. Every change is additive, so a database that already ran 001
-- to 003 keeps its rows.

-- The order in which the runs entered the queue. The queue reads the oldest run first, and a
-- number is a better order than a timestamp, because two runs can share a timestamp.
ALTER TABLE sandbox_runs ADD COLUMN seq bigserial;

-- The source of the run, exactly as the client named it. The SKILL.md the worker reads is fetched
-- from this reference, at the pinned commit, and never from the client.
ALTER TABLE sandbox_runs ADD COLUMN src text;

-- The UTC day the quota was taken on. A refund goes back to the same day it was taken from.
ALTER TABLE sandbox_runs ADD COLUMN quota_day date;

-- The probe results the worker has reported so far. A violation is stored here as soon as it is
-- seen, so it survives the worker disappearing before the run ends.
ALTER TABLE sandbox_runs ADD COLUMN probes jsonb;

-- The run id the worker knows the run by. It is the same id, but the column keeps the link
-- between the two services readable.
ALTER TABLE sandbox_runs ADD COLUMN worker_run_id text;

-- The SKILL.md the worker receives. It is read from the commit the source names and never from
-- the client, and it is kept with the run so the worker is not asked for it twice.
ALTER TABLE sandbox_runs ADD COLUMN skill_md text;

-- The run already carries a result, because the result was in the cache and the worker was never
-- asked. Such a run is finished by the queue without a run of the worker and without a slot of
-- the quota.
ALTER TABLE sandbox_runs ADD COLUMN from_cache boolean NOT NULL DEFAULT false;

-- The sandbox is paused for the rest of the day when the worker reached its daily cost limit. The
-- day is the key, so the pause ends by itself when the day ends.
CREATE TABLE sandbox_pause (
  day date PRIMARY KEY,
  reason text NOT NULL,
  paused_at timestamptz NOT NULL
);

-- One run at a time. The index is what enforces it, so two services that both try to start the
-- next job cannot run two jobs at once.
CREATE UNIQUE INDEX sandbox_runs_one_running_idx ON sandbox_runs (status) WHERE status = 'running';

-- The queue reads the oldest queued run first.
CREATE INDEX sandbox_runs_queue_idx ON sandbox_runs (status, created_at);

-- The target page reads the newest run of a bundle.
CREATE INDEX sandbox_runs_bundle_idx ON sandbox_runs (bundle_hash, created_at DESC);

-- A run always knows the day its quota belongs to, so a refund never lands on another day.
UPDATE sandbox_runs SET quota_day = (created_at AT TIME ZONE 'UTC')::date WHERE quota_day IS NULL;
