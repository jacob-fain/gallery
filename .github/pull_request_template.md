<!--
The body must stand alone for a reader with no context: what changed, in the
codebase's terms, and why it matters. No conversation references.
-->

## Verification

<!-- Gate result, tests added, what was checked by hand. -->

## Checklist

- [ ] The checks in `.github/workflows/ci.yml` pass locally
- [ ] The test that would catch this regression is included
- [ ] Migrations are safe on existing data and drop nothing the running release reads
- [ ] Closes the issue it answers (`Closes #N`)
- [ ] No em dashes, no emojis, no authorship trailers
