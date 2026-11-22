# Sealflare design

This folder is the visual source of truth. Read it before building or changing any screen.
It is written for people and for coding agents alike.

## Read in this order

1. [system/README.md](system/README.md): the brand rules. Color, type, shape, the two motifs,
   motion, copy tone, accessibility. Short, and everything else follows from it.
2. [system/tokens.css](system/tokens.css): every color as a CSS variable, dark and light. Copy it
   into the app as is. [system/tokens.json](system/tokens.json) is the same data with a usage note
   per token, plus the type styles, spacing scale and control sizes.
3. [system/components/bundle.css](system/components/bundle.css): the `sf-` component classes. Each
   component has a `README.md` and a `preview.html` in its own folder under `system/components`.
4. [screens/](screens): the eight designed screens. Open the one for the screen you are building.
5. [../ux.md](../ux.md): what each screen must do, every state, and the exact UI strings.

## Live versions, for Claude users

These are Claude Artifacts. They are private to the founder's account, so anyone else needs the
founder to share them first. Everything in them is also in this folder.

| Artifact | Link | What it is |
| :--- | :--- | :--- |
| Visual canvas | https://claude.ai/artifact/X8KxdB8hnoQr342ivZnU1d | The eight screens side by side, each with a dark or light theme switch |
| Sealflare Design System | https://claude.ai/artifact/FmyjzsWpiP1fKSe44foWvZ | Tokens, brand notes and component previews |
| Zorvo Design System | https://claude.ai/artifact/8w2xRW4Fs8KZV7SyLYddpJ | The parent ecosystem Sealflare borrows two rules from; reference only |

To deep-link one screen on the canvas, add `#artboard-<Name>` to the canvas link, where `<Name>`
is the screen's file name without the extension, for example `#artboard-Dispute`.

## The screens

| File | Screen | Route | What it shows |
| :--- | :--- | :--- | :--- |
| [Landing.dc.html](screens/Landing.dc.html) | Landing | `/` | Hero with the large seal, the product card, the six attacks, four steps, the lime band |
| [Scan.dc.html](screens/Scan.dc.html) | Scan | `/app` | The scan field and what happens while checks run |
| [Main.dc.html](screens/Main.dc.html) | Target page | `/app/t/[id]` | Identity, status card, signal breakdown, action column, tabs |
| [Explore.dc.html](screens/Explore.dc.html) | Explore | `/app/explore` | The table pattern with a small seal per row and segment filters |
| [Panels.dc.html](screens/Panels.dc.html) | Attest panel | on the target page | Three states side by side: choose a verdict, review and sign, no Agent ID |
| [Dispute.dc.html](screens/Dispute.dc.html) | Dispute | `/app/disputes/[id]` | Phase strip, both sides' evidence, the four outcomes, the jury panel |
| [Activity.dc.html](screens/Activity.dc.html) | My activity | `/app/me` | Needs action, balance, standing, history |
| [Publish.dc.html](screens/Publish.dc.html) | Publish | `/app/publish` | The three numbered steps: contract, ownership proof, bond |

Screens that have no drawing reuse a drawn pattern. Do not invent a new one.

| Screen | Route | Reuse |
| :--- | :--- | :--- |
| Disputes, Bounties, Guardians | `/app/disputes`, `/app/bounties`, `/app/guardians` | The Explore table and segment filters |
| Guardian profile | `/app/g/[address]` | The standing panel and history table from My activity |
| Open a challenge, join the jury, reveal, bounty, bond | panels | The stepped Attest panel |
| Docs | `/docs` | The landing's type scale and section spacing |

All numbers, addresses and names in the screens are sample data, and each screen says so in a
small note at the bottom. Never copy them into the product as if they were real.

## How to read a `.dc.html` file

Each screen is one self-contained HTML file in a component format. You do not need its runtime:

- The page markup is everything inside `<x-dc>` after the `<helmet>` block. Read it as plain HTML.
- `<helmet><style>` holds that screen's CSS: the token block (`.sf` for dark, `.sf.is-light` for
  light) and the helper classes the screen uses. The token values match `system/tokens.css`; the
  screens use short names (`--bg`, `--fg`, `--muted-fg`) where the system uses the full shadcn
  names (`--background`, `--foreground`, `--muted-foreground`). Use the full names in the app.
- `{{themeClass}}` is the only template hole. It is empty for dark and `is-light` for light.
- The `<script type="text/x-dc">` block at the end only switches the theme. Ignore it, except in
  `Landing.dc.html`, where it also runs the seal's break-and-reseal loop.
- Inline `style` attributes carry the exact spacing and sizes. Treat them as the measurement.

## Patterns the screens add to the system

The design system documents eight components. The five later screens use four more patterns that
are not written up there yet. Their CSS is in the screen's own `<helmet>`.

| Pattern | Class | Defined in | Use it for |
| :--- | :--- | :--- | :--- |
| Stepped panel | `.panel`, `.pane` | `Panels.dc.html` | Any action with a review step before a signature |
| Choice box | `.opt` | `Panels.dc.html` | Picking one verdict, or one vote, from two or three |
| Segment switch | `.seg` | `Explore.dc.html`, `Publish.dc.html` | Filters and a choice between two kinds |
| Numbered step | `.step`, with `.done`, `.now`, `.next` | `Publish.dc.html` | A flow whose steps stay visible on one page |
| Data table | `.t`, with `.n` for numbers and `.z` for zero or muted cells | `Explore.dc.html` | Every list page |
| Action row | `.todo` | `Activity.dc.html` | One thing waiting on the user, with its deadline and button |

Shared helpers found in every screen: `.mono` (Geist Mono), `.cap` (the small lowercase mono
label), `.row` (label left, value right), `.btn` with `.btn-p` primary, `.btn-s` secondary and
`.btn-g` ghost, `.chip`, and `.crop` (the two corner marks).

## Rules that are easy to break

- **Radius is 0.** No rounded button, chip, card or input. The seal is the only round thing.
- **One primary button per view.** Everything else is secondary or ghost.
- **Lime is a fill (`primary`) or a state (`positive`).** When lime must be text or a line, use
  `positive`, which is darker in the light theme so it stays readable.
- **State color always sits beside a word.** Never color alone.
- **Crop marks go on one or two frames per screen**, the object being sealed. Not on every card.
- **Hairlines, not shadows.** No box-shadow, no gradient, no glow, no glass blur.
- **Never one blended score.** Wherever a target's status shows, the vote counts show with it.
- **Two fonts only.** Instrument Sans for text, Geist Mono for anything a machine produced.
- **Copy is English, sentence case, no em dash, no emoji, no exclamation mark.** The exact strings
  are in [../ux.md](../ux.md); use them as written.
- **Both themes.** Build with the variables so dark and light both work, then look at both.
- **Narrow screens.** Nothing may overflow sideways at 375 px. Columns stack, tables become cards,
  a stepped panel becomes a full sheet, the main action sticks to the bottom edge.

## What is not designed yet

- A logo. Until there is one, the name is set as type: `seal` in `foreground`, `flare` in
  `positive`, lowercase, Instrument Sans 600.
- An icon set. The screens use words and the seal mark instead.
- The light theme of the five later screens has not been checked visually.
