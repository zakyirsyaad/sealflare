Sealflare checks smart contracts and AI skills on BNB Chain before an agent touches them, and lets Agent ID holders vouch for the result on-chain. The look is a spec sheet: neutral greys, square corners, one lime, and a single round object, the seal.

## Where this system comes from

- **The preset.** Colors, the secondary fill and `radius: 0` come from a shadcn preset the founder chose. Token names are shadcn's, so `primary` is `var(--primary)` in CSS and `bg-primary` in Tailwind.
- **Zorvo.** Sealflare is part of the Zorvo ecosystem. It keeps Zorvo's rules that color means state and that code is set in Geist Mono, and it sets all text in Instrument Sans, the face of the `zorvo` wordmark. It does not use Zorvo's zinc greys or rounded corners.
- **Eight screens.** Landing, Scan, Target page, Explore, the Attest panel states, Dispute, My activity and Publish on the [visual canvas](https://claude.ai/artifact/X8KxdB8hnoQr342ivZnU1d) are where every rule here was drawn. Their sources are in `../screens`.

Four values differ from the preset on purpose. Each token's usage note says why: `primary-foreground` and light `muted-foreground` for contrast, `positive` so lime can be text on white, `warning` because the product has a middle verdict.

## Content fundamentals

Write short, plain sentences. State what the scan found and what happens next.

- **Sentence case** everywhere: "Open a challenge", "Fund an audit bounty". Mono labels are lowercase: "community signal", "passed".
- **Buttons are verbs**, one to four words: "Scan", "Attest", "Connect wallet".
- **Say the stake before the signature.** A summary names what is written on-chain, how much BNB moves and what can be lost: "A wrong safe vote costs 15 reputation."
- **Never one blended score.** Show who voted and how, split by experience.
- **Errors say what happened, then what to do**: "No contract is deployed at this address on BNB Chain. Check the network and the address."
- **No exclamation marks, no emoji**, and none of "seamless", "unlock", "empower", "powerful".
- **Mark what is not real.** Sample data carries a `micro` note; a missing link is written as `[link after deploy]`. No user counts, partner logos or quotes until they exist.

Real copy to match:

> Trust the code your agent runs.
>
> Scan any BNB Chain contract or AI skill. Real people sign off on the result, one Agent ID, one vote.

## Name and logo

There is no logo yet. Until one is made, the name is set as type:

- `sealflare`, lowercase, Instrument Sans 600, letter-spacing -0.04em.
- `seal` in `foreground`, `flare` in `positive`.
- Never capitals in the wordmark, never another typeface, never an icon invented beside it.

## Color

Neutral greys carry the interface. Lime is the only brand color, and three colors mean state.

- Paint the page `background`. Raise panels as `card` with a `border` edge. Inside a card, chips and evidence lines are `muted`.
- Text is `foreground`. Secondary text, labels and captions are `muted-foreground`.
- A view has **one** `primary` button. Every other button is `secondary`, or ghost in a toolbar.
- `primary` is a fill. When lime must be text or a line, use `positive`.
- State colors always sit beside a word:
  - `positive`: sealed, passed, safe.
  - `warning`: caution, flagged.
  - `destructive`: broken, reported, danger, blocked.
- A filled state label (the `blocked` tag) is `destructive` with `background` text.
- A tinted state surface is the state color at 9 to 16 percent over the ground, with the full color as text or edge.
- The landing may end on one full-width `primary` band with `primary-foreground` text. Use it once per page.

## Type

Two families, loaded from Google Fonts.

- **Instrument Sans** (`sans`) for all text, weights 400, 500 and 600.
- **Geist Mono** (`mono`) for anything a machine produced or a person must copy: addresses, hashes, counts, flag names, logs, and the lowercase labels above a block.
- Headlines are tight: 600 weight, letter-spacing around -0.045em, line height near 1. Keep them to two lines.
- `ui` (14px) is the app's workhorse. `body` (15px) is for the landing.
- Never set a sentence the user must act on in `micro`.

## Shape and layout

- **Square.** `radius` is 0 for everything. Do not round a button, a chip or a card.
- **Hairlines, not shadows.** Structure comes from 1px `border` rules. Nothing casts a shadow.
- **Shared edges.** Cells in a row share one border, like a table: the fact strip, the four steps, the attack list.
- **Container** 1240px, gutter `space-10` on desktop and 20px on a phone.
- Landing sections are padded `space-28` top and bottom. App pages are denser: `space-6` between panels.

## The two motifs

**The seal.** A ring built from a file hash: hash text on the outside, a tick ring, a thick arc, the state word in the middle. It is the only round thing in the system, so it is always the focal point.

- Sealed: a closed `positive` arc.
- Caution: a `warning` arc with a gap.
- Broken: a `destructive` arc with a gap, and flare rays outside it.
- Nothing rated yet: a dashed `ring` arc.
- The large seal belongs to the landing hero. Small seals mark status on a target card and in empty states. Use at most one large seal per page.

**Crop marks.** Two `positive` corner marks, top left and bottom right, on a framed object: the seal, the product shot, the sandbox log, the scan field, the status card. They say "this is the sealed thing". Do not put them on every card; one or two frames per screen.

## Motion

- Color and background transitions run 150ms.
- The landing seal draws closed on load, then breaks and reseals by itself every few seconds. There is no control on screen for it; a click on the seal pauses it.
- Sections may rise in as they scroll into view. Content is always visible without the animation.
- Everything stops under `prefers-reduced-motion`.

## Iconography

There is no icon set yet. The screens use words and the seal mark instead of icons. If icons are added, draw them as square-cap line icons at 1.5px stroke in the text color of their context, and never use emoji.

## Accessibility

- Text pairs were checked at 4.5:1 or better in both themes: `primary-foreground` on `primary`, `muted-foreground` on `background`, `card` and `muted`, and `positive`, `warning` and `destructive` on `background` and `card`.
- Every control shows a 2px `ring` outline on keyboard focus.
- State is never color alone: each state color sits beside its word.
- Controls are at least 32px tall; primary actions are 48px or more.
