# PR #29 maintainer follow-up

PR #29 contains Scanning Tasks 7–11, the confirmation compatibility follow-up, both review
rounds, Docker Dependabot and the maintainer corrections below. It is the consolidated landing
PR. Earlier PRs remain open until the founder merges this PR and closes them as superseded.

| Review note | Resolution and evidence |
| :--- | :--- |
| Important: hidden financial extra fields | Unknown extras are retained through strict transaction validation. Only a short `memo` equal to `formatting-only`, `memo` or `note` (case/whitespace normalized) can reuse the canonical confirmation. Other memo prose fails closed: it cannot be reliably proven harmless by a number/keyword denylist. Regressions cover bundled fees, `allowance: 'max'`, word/Unicode amounts, unbounded wording and spaced unlimited spelling. The two original examples derive `SANDBOX_FUZZ_FAILED`. |
| Boundary follow-up: parser removes a JSON extra | An own `__proto__` key is enveloped before record parsing in both provider decoding and local tool-call parsing. Other fields stay visible for rule checks. The strict handler refuses the call; the original payload survives the frozen evidence schema, disk and restart under `invalidArgs`. Four regressions exercise handler rejection, replay, secret-read targeting and the full provider/runner/store flow. |
| Minor: legacy records permanently fault health | Legacy IDs remain blocked; a usable worker returns 200 with an aggregate `blockedLegacyRuns` count. Persistence faults still return 503 and refuse new work. Tests cover one/multiple blocked records and a coexisting storage fault. |
| Minor: routing/organization policies become skill errors | Content classification requires the recognized `content_filter_blocked` code or anchored explicit content-filter wording without an unknown code. Conversation validation is limited to known numeric length or typed-message formats, so path-prefixed operator errors cannot bypass it. Fourteen negative regressions complement the existing content-block/validation positives. |
| Partial: secret canary shares the sandbox hostname prefix | The real secret probe and default read responses now use opaque canaries. The actual probe accepts an unrelated `sandbox-api` hostname, while raw/Base64/hex eight-character canary fragments remain detectable. |
| Partial: tool results disclose the simulation | Default read, HTTP, signature and transaction replies omit simulation markers. No tool gains network, filesystem, environment access or actual signing; the existing no-I/O tests remain authoritative. |
| Official endpoint check | One direct request with all 12 production tool definitions and the maintainer-provided gateway credential returned 401 `authentication_error`. README records the model, timestamp, request ID and schema digest. The credential was not accepted by the official endpoint, so successful official schema validation remains pending a working official credential. This does not establish a gateway failure. |
| Consolidated landing and repository configuration | The PR title/body cover Tasks 7–11 and all follow-ups. The Docker Dependabot change remains subject to founder approval on PR #29. No PR is merged or closed by this follow-up. |

## Verification record

After merging current `main` into the branch, `pnpm install --fix-lockfile` regenerated the
lockfile from main's locked dependencies plus the worker package. No application source was
edited to resolve the conflict. Baseline `pnpm verify` passed before the new tests.

The new targeted test run produced 29 expected failures before implementation: unsafe extras,
simulation disclosure, default partial exfiltration, the real-probe hostname false positive,
legacy health and operator-policy classification. The same targeted tests passed after the fixes.
Independent review found that free-form memo prose still concealed word/Unicode amounts and
unbounded instructions. Four additional cases were observed RED before replacing the memo
denylist with the explicit neutral-label allowlist; their targeted run then passed.
TypeScript review found two more boundary paths: operator-policy messages prefixed with a
message path, and an own JSON `__proto__` extra stripped by record parsing. Six policy cases and
three handler/replay/provider-storage cases were observed RED before their fixes. One additional
RED regression ensures other argument fields stay visible when that raw payload is retained. The latter
initially returned `NO_VIOLATION_OBSERVED`; it now records `SANDBOX_FUZZ_FAILED` through restart.
Existing tests that asserted the old health/prefix behavior were updated, and the probe source
fingerprint was refreshed so cached clean results cannot cross this behavior change.

Final local `pnpm verify` passed: 1,449 TypeScript tests (480 worker, 331 scanner, 284 shared,
202 web, 66 internal, 50 SDK, 36 indexer), all typechecks, 302 Foundry tests and ABI sync.
Four paid live checks are opt-in and skipped in the ordinary suite. Secret scanning passed.
CI results are recorded on the PR after publication. API authentication failure is not counted
as successful tool-schema validation or a clean sandbox result.
