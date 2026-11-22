The scan field is one mono input joined to a primary Scan button, with no gap between them.

## Use

Wrap an `sf-scan__input` and an `sf-btn sf-btn--primary sf-btn--xl` in a `<form class="sf-scan">`. On a narrow screen the button drops under the input and fills the row.

## Rules

- It accepts a BNB Chain contract address or a link to a skill repository. The kind is detected, so never add a contract or skill switch.
- The input is set in `mono`, because what goes in it is an address or a path.
- Give the input a `<label>`. Hide it visually if the placeholder already shows the format, but keep it in the markup.
- On the Scan page the field is 68px tall and wrapped in a Frame, so it carries crop marks.
- Say under it that scanning needs no wallet.

You provide: the submit handler, and the error text when the input is not an address or a repository link.
