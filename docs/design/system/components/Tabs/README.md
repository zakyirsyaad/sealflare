Tabs switch the lower half of a target page between its six views.

## Use

A `<div class="sf-tabs" role="tablist">` holding `<button class="sf-tab" role="tab">` items. The selected tab has `aria-selected="true"`, which turns its text to `foreground`, weight 600, and draws a 2px `positive` rule under it. A count goes in `sf-tab__count`.

## Rules

- The order on a target page is fixed: Findings, Attestations, Publisher, Dispute, Bounty, History. Findings opens first.
- The same rule marks the current page in the app navigation.
- No background fill and no pill on the selected tab.
- On a narrow screen the row scrolls sideways; tabs never wrap.
- Left and right arrow keys move between tabs.

You provide: the labels, the counts, the selected tab and the panel each one shows.
