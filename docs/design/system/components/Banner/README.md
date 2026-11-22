A banner states one condition of a target that overrides everything else on the page.

## Use

- `sf-banner`: a caution, edged in `warning`. Used for a proxy, an open dispute, an unbonding publisher.
- `sf-banner sf-banner--danger`: edged in `destructive`. Used for a confirmed danger, and for code that changed since it was sealed.

Put the condition in `sf-banner__title` and the consequence in `sf-banner__text`.

## Rules

- It sits above the status card and cannot be dismissed.
- The edge runs on all four sides. Never a colored left stripe alone.
- The square marker before the title is the state color; the title carries the meaning in words.
- One sentence for the condition, one for what it means for the user.
- Give it `role="status"`.

You provide: the title, the text, and the kind.
