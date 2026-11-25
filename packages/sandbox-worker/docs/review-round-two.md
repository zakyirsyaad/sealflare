# Founder review follow-up, round two

This follow-up covers every founder comment added to open Scanning PRs on 25 November 2026.
Frozen shared schemas remain unchanged. The Docker configuration change remains subject to
founder approval before merge.

| # | Original PR | Resolution |
| :--- | :--- | :--- |
| 1 | #17 | Publish the confirmation tool as one flat object with no root combinator or nested `$schema`; host Zod keeps the exact union. |
| 2 | #17 | Add repeatable live checks for every probe and a complete 18-run clean-fixture set. |
| 3 | #18 | Keep installed-skill framing while treating tool output as data and retaining credential/secret host policy. |
| 4 | #18 | Match fresh random default canaries, including the secret probe; exclude descriptive prefixes when replaying older host responses. Explicit fixed canaries are confined to controlled test scenarios. |
| 5 | #18 | Classify explicit provider output/content policy blocks as skill-content failures. |
| 6 | #18 | Scan every HTTP argument, including headers and malformed `invalidArgs`, for returned data. |
| 7 | #18 | Remove explicit simulation/mock disclosure from model-visible prompts, tool descriptions and default responses. |
| 8 | #18 | State whole-token units in transfer, approval and swap tool descriptions. |
| 9 | #18 | Only a harmless string memo can downgrade a matching confirmed transaction to a content error. Unknown, financial or unsafe extras remain violations. |
| 10 | #19 | Document terminal/bounded handling for BUSY while retaining the frozen response reasons. |
| 11 | #19 | Normalize scientific, whitespace, caret and Solidity max spellings for unlimited evidence. |
| 12 | #19 | Reject short environment/file scenario canaries before any paid model request. |
| 13 | #19 | Report legacy-blocked recovery as an aggregate count on 200 health; reserve 503 for persistence faults that prevent admissions. |
| 14 | #20 | Record lane-owner authorization separately from pending founder sign-off on repository config. |
| 15 | #20 | Ignore Node semver-major Docker updates while retaining digest and compatible updates. |

Behavior changes have regression tests that were observed failing before implementation. With
the final flat tool schema, the clean fixture passed one run through each of the six real probes
and a separate complete 18-run set on the authorized gateway. Direct `api.anthropic.com`
validation was initially unclaimed because no official Anthropic key was available. The later
direct official request and its authentication failure are recorded in
[the maintainer follow-up](maintainer-review.md) and the worker README.
