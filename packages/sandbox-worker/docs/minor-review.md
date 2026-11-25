# Minor review follow-up

This follow-up covers the 18 minor founder comments on Tasks 7–11. Frozen shared schemas are
unchanged. Each behavior change has regression coverage; prose/config choices are verified
through the existing call traces, typechecks and actual container build.

| # | Original PR | Resolution |
| :--- | :--- | :--- |
| 1 | #11 | Common textual unlimited amounts retain `UNLIMITED_APPROVAL` evidence. |
| 2 | #11 | Exfiltration matching requires read values of at least eight UTF-16 code units. |
| 3 | #11 | Hoist the unlimited threshold and compare once, preserving exact boundaries. |
| 4 | #12 | Remove the user's instruction to bypass consent; keep the neutral fast-transfer request and host consent baseline. |
| 5 | #12 | Document that meta-scanner checks wallet behavior, not final-text safety claims. |
| 6 | #12 | Validate scenarios while defining probes, before paid calls. |
| 7 | #12 | Recursively fingerprint nested sources with LF-normalized line endings. |
| 8 | #13 | A failed skill has no incomplete label for later content errors. |
| 9 | #13 | Preserve distinct exhausted-budget and unavailable-budget reasons. |
| 10 | #13 | Persist the UTC day and spend in the mounted run directory across restarts. |
| 11 | #13 | Keep file flushing and atomic rename, skipping unsupported Windows directory fsync. |
| 12 | #14 | Require capacity for at least 18 calls at admission. |
| 13 | #14 | Use the existing 429/BUSY schema for conflicting IDs and unavailable admission storage. |
| 14 | #14 | Retain/report legacy interrupted records, block their IDs, and allow unrelated work. |
| 15 | #14 | Fault health on storage writes; keep committed status snapshots readable after other errors. |
| 16 | #16 | Report missing usage as unknown counters, without changing the run outcome. |
| 17 | #16 | Pin both Node base stages by the same registry manifest digest. |
| 18 | #16 | Remove the redundant package `.dockerignore`; keep the Dockerfile-specific exclusions. |

## Digest maintenance

The digest was resolved from the official `node:24-slim` manifest on 25 November 2026 with
`docker buildx imagetools inspect`. The Dockerfile is pinned to
`sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530`.

The repository's `.github/dependabot.yml` includes this weekly Docker updater alongside its
GitHub Actions updater:

```yaml
- package-ecosystem: docker
  directory: /packages/sandbox-worker
  schedule:
    interval: weekly
  ignore:
    - dependency-name: node
      update-types:
        - version-update:semver-major
  commit-message:
    prefix: chore
```

The lane owner authorized proposing this repository-config change on 25 November 2026. The
founder [approved the configuration on PR #29](https://github.com/zakyirsyaad/sealflare/pull/29#issuecomment-7171183750)
on 26 November 2026, specifically as it stood at `3a72b6e`. The approved file is unchanged;
this file-level sign-off does not grant approval to the whole PR. The updater scans this
package's Dockerfile and proposes Node 24 digest/minor updates with a `chore` commit prefix while
ignoring Node major-version jumps. Scheduled checks take effect after the configuration reaches
the default branch; each proposed update still needs the repository's CI and review checks.

## Operational limits

Run one worker against each run directory. Keep `.budget` on a persistent volume and include it
in backups. Removing it resets spend; corruption stops startup instead of resetting the breaker.
The admission check guarantees the 18-step minimum, so a multi-step probe may still reach the
daily limit partway through. No daily budget reservation or cross-process lock is implied.

Legacy records missing recovery identity keep their original bytes and any violation evidence.
They are counted as `blockedLegacyRuns` on HTTP 200 health while unrelated IDs remain admissible.
Actual persistence faults still make health 503. Operators can archive legacy records
after inspection; the worker cannot safely invent their bundle/model identity. Storage fault
status reads show only previously committed snapshots and do not turn unfinished work into a
final clean result. Lane 3 treats BUSY for a conflicting/legacy ID, unhealthy worker, or expired
bounded retry window as a terminal infrastructure failure rather than retrying forever.
