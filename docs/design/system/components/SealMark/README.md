The seal mark is a small ring that shows a target's verdict at a glance, always beside the verdict in words.

## Use

An inline `<svg class="sf-seal">` with a `sf-seal__track` circle and a `sf-seal__arc` circle on top. The state is a class on the svg:

- no modifier: a closed `positive` ring. Community safe, Warranty backed safe.
- `sf-seal--caution`: a `warning` ring with a gap. Caution flagged, Disputed.
- `sf-seal--broken`: a `destructive` ring with a wide gap. Confirmed danger, Modified since audit.
- `sf-seal--empty`: a dashed `ring` arc and no track. Not rated yet.

The gap comes from `stroke-dasharray` on the arc, as in the preview. Sizes in use: 76px on a target page, 52 to 56px in a card or an empty state.

## Rules

- It is the only round shape in the system. Do not draw other circles, dots or pills near it.
- It never stands alone. The verdict is written next to it in `title-lg` or `title`.
- Give the svg `role="img"` and an `aria-label` with the state, or `aria-hidden="true"` when the verdict text is right beside it.
- Stroke caps are flat, not round.
- The large animated seal on the landing is a one-off built on the same ring. It is not this component.

You provide: the state and the size.
