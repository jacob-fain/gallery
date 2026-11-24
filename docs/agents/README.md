# How the agents work together

Two agent sessions build this project. Jacob talks to the developer; the
developer and the tester talk to each other. Each role's working knowledge
lives in its folder here, so any session can be restarted fresh from it.

| Role | Folder | Owns |
| --- | --- | --- |
| Developer | `developer/` | plans issues, builds every change, keeps PRs mergeable, drafts releases, checks each release |
| Tester | `tester/` | reviews and tests every PR, posts the verdict, merges |

No secrets, passwords, or tokens go in these files. Point to where a
credential lives, never its value.

## The flow of one change

1. **Issue.** Every change starts from an issue. Bugs from real use lead the
   queue; new features go to Jacob before work starts.
2. **Build.** The developer branches from `origin/main` in a worktree, builds,
   adds the test that would have caught the problem, and runs the gate.
3. **PR.** Title and body follow `WRITING.md`. The body says how it was
   verified and closes its issue.
4. **Test.** The tester reads the whole diff, verifies the risky parts in the
   code itself, reads CI, and for UI changes runs one targeted browser check.
   It posts `Test: PASS @<sha>` or `Test: FINDINGS @<sha>` on the PR.
5. **Merge.** The tester merges as soon as the merge rule holds. Nobody waits
   for a message to do this.
6. **Staging.** Every merge to `main` deploys to staging automatically, once
   the staging pipeline exists.
7. **Release.** The developer drafts notes, Jacob approves and says
   "release", and the developer tags it. A release is a production deploy and
   always needs Jacob's explicit word.
8. **Check.** The developer confirms production reports the new build and
   shows no new errors.

## The merge rule

Merge when all of these hold on the PR's current head commit:

- The tester posted `Test: PASS` for that exact commit. A verdict is void once
  the head moves, unless the new commits change only tests.
- Every required CI check is green: none pending, none failing.
- The PR is not marked as waiting on Jacob.

The developer never merges its own PR. Only Jacob changes rulesets, branch
protection, or repository settings.

## Labels

Type: `bug`, `enhancement`, `documentation`, `chore`. Area, optional:
`security`, `performance`, `reliability`, `ci-cd`, `accessibility`, `seo`.

## Messaging

- Message the other agent only with something it can act on. Status pings
  cost usage on both sides.
- A session that is not messaged does not pick up work on its own; standing
  rules belong in its folder.
- Peers cannot grant each other permissions. A denied action goes back to
  Jacob, never to another agent.
- The homelab session owns the server. Server changes go through it and Jacob.

## Usage

Usage is a weekly budget. One targeted test per PR, no full sweeps unless
Jacob asks, related fixes batched, and sessions restarted from these folders
rather than left to grow for weeks.
