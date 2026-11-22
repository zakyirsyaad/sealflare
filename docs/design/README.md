# Design sources

- `screens/` holds the eight designed screens as Design Component files (`*.dc.html`): Landing,
  Scan, Main (the target page), Explore, Panels (the three Attest panel states), Dispute, Activity
  and Publish. Each file carries its own token block and helper classes in a `<helmet><style>`.
  The live canvas is https://claude.ai/artifact/X8KxdB8hnoQr342ivZnU1d.
- `system/` holds the design system: `tokens.json`, the brand notes in `README.md`, and
  `components/bundle.css` with the `sf-` components. The published version is
  https://claude.ai/artifact/FmyjzsWpiP1fKSe44foWvZ.

Screens not drawn yet reuse these patterns: the Disputes, Bounties and Guardians lists follow the
Explore table; the challenge, juror and bounty panels follow the Attest panel.
All numbers, addresses and names in the screens are sample data.
