# Writing guide

Agents write most of the code, comments, commits, PRs, and issues here, and all
of it posts as Jacob. These are the rules from CLAUDE.md, with examples.

## Everywhere

- No em dashes. Use a comma, colon, period, or parentheses.
- No emojis.
- No AI credit of any kind: no co-author trailers, "generated with" footers, or
  session links.
- Write for a reader with no context: no names, no "as discussed", no dates of
  decisions, no review rounds.

## Code comments

A comment states what the code cannot say: the invariant, the constraint, the
reason for a non-obvious choice. It never narrates what the code does, and
never records who decided or when.

| Instead of | Write |
| --- | --- |
| `// per Jacob, hide the badge at zero` | `// Hidden at zero: a 0 badge reads as an alert.` |
| `// loop over photos and sum the sizes` | (no comment: the code says this) |
| `// fixes #61` | `// A blank field keeps the stored password: null tells the API to remove it (#61).` |
| `// round 2 review fix` | `// Signed URLs are cached for less than their lifetime, so a cached URL never expires mid-view.` |

Issue numbers are fine where a reader can follow them for depth.

## Commits and PRs

- Subject: what changed, in the codebase's terms, present tense ("Editing a
  private gallery keeps its password"), not the ticket's wording.
- Body: the problem and why the change solves it. State the underlying problem
  ("saving the edit form sent null, which removes the password"), not who
  reported it.
- A PR body ends with how it was verified: gate result, tests added, what was
  checked by hand.
- Close or reference issues by number (`Closes #61`, `Part of #114`).

## Issues

- Title: the problem in the user's words. Body: where, steps, what happens,
  what should happen, and "Done when".
- Status comments name the PR or commit that changed things.

## Verdicts

The tester's verdict comment starts with exactly one of these lines, using the
full 40-character head commit it checked:

```
Test: PASS @<sha>
Test: FINDINGS @<sha>
```
