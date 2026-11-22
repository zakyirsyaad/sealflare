A square button in three kinds: primary, secondary and ghost.

## Use

- `sf-btn sf-btn--primary`: the one primary action in a view, filled `primary` with `primary-foreground` text. Scan on the landing and Scan page, Attest on a target page.
- `sf-btn sf-btn--secondary`: every other action, filled `secondary`.
- `sf-btn sf-btn--ghost`: low-weight actions in a toolbar, such as Copy address.

Sizes: default is `control` (36px). Add `sf-btn--md` (40px) in the actions panel, `sf-btn--lg` (48px) for the primary action there, `sf-btn--xl` (56px) beside the scan field. Add `sf-btn--block` to fill its column.

## Rules

- One primary button per view. If two actions compete, one of them is secondary.
- The label is a verb, one to four words, sentence case.
- A disabled button turns `muted` with `muted-foreground` text and shows `cursor: not-allowed`. Say why beside it, for example when the daily limit resets.
- Use a real `<button>` for an action and an `<a class="sf-btn">` for navigation.

You provide: the label, the kind, the size and the click handler.
