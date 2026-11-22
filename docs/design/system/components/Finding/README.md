A finding row shows one check from a scan: its state, what was found, and the line that proves it.

## Use

An `<li class="sf-finding">` with three parts:

- `sf-finding__state`: a lowercase mono word. Add `--passed`, `--flagged` or `--reported` for the color. Without a modifier it is `muted-foreground`, for `not run`.
- `sf-finding__body`: the `sf-finding__title`, then either an `sf-finding__proof` line or an `sf-finding__note`.
- An optional flag Chip at the end.

## Rules

- The state word is always there. Color alone never tells the state.
- `passed` is what the scanner checked and found clean. `flagged` is what the scanner found. `reported` is what guardians attested.
- The proof line is the exact evidence: a function signature, a storage slot, a captured tool call. Copy it, do not paraphrase it.
- A check that could not run says `not run` and why. It is never shown as passed.
- Rows share hairlines; the last one has none.

You provide: the state, the title, the proof or note, and the flag name if there is one.
