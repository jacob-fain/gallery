# Developer procedures

## The gate

Run all of it and read each exit code before opening a PR.

From the repository root:

```sh
(cd backend && npm ci && npm run typecheck && npm test && npm run build)
(cd frontend && npm ci && npx eslint . --max-warnings 0 && npm test && npm run build)
```

Database-backed tests (`*.db.test.ts`) run only when `TEST_DATABASE_URL` is
set, against a throwaway database whose name ends in `_test`; the setup
drops its schema and rebuilds it with the migration runner. To run them locally:

```sh
docker run -d --rm --name gallery-test-pg -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=gallery_test -p 127.0.0.1:55432:5432 postgres:15-alpine
(cd backend && TEST_DATABASE_URL=postgresql://test:test@127.0.0.1:55432/gallery_test npm test)
docker rm -f gallery-test-pg
```

These are the same steps CI runs (`.github/workflows/ci.yml`), so a green
local gate predicts a green CI run. Lint warnings fail the gate, as they do in
CI.

On this machine `npm i <pkg>` hangs while installing. To add or bump a
dependency, run `npm i <pkg> --package-lock-only --ignore-scripts` on a copy
of `package.json` and `package-lock.json` in a scratch directory, copy both
back, then `npm ci`.

## Open a PR

1. `git fetch origin && git worktree add .claude/worktrees/<name> -b <branch> origin/main`.
2. Stage new files by name (`git add <file>`). `git add -u` skips untracked
   files, so check `git status -s` for `??` before committing.
3. Commit with a subject and body that follow `WRITING.md`. Commits are
   authored by Jacob's git identity with no trailers.
4. Run the gate, push, and open the PR with `gh pr create`. The body ends with
   how it was verified and `Closes #N`.
5. Edit a PR body with `gh api -X PATCH repos/jacob-fain/gallery/pulls/<n> -F body=@file`;
   `gh pr edit --body` fails on this repository.
6. Tell the tester the PR number and head sha, and whether it changes the UI.

## Keep a PR mergeable

- Once the tester has a PR, push to it only when the tester asks or to fix
  its findings, and send the new head sha. A push while the tester is merging
  makes the merge API refuse. If `main` moves under a queued PR, report
  whether it still merges cleanly and let the tester ask for an update.
- When `main` moves and a PR conflicts, merge `main` into the branch, build,
  and read the exit code. If the tester has the PR, push only after it asks.
  Never force-push.
- A test-file conflict keeps both sides' tests.

## CI failures

- Read the failing assertion in the job log before deciding anything
  (`gh run view <run> --log-failed`).
- A step that times out installing tools is infrastructure: rerun only the
  failed jobs (`gh run rerun <run> --failed`).
- A failure that reproduces on a rerun is real, not flaky.

## Release

1. Every PR planned for the release is merged and `main` CI is green.
2. Draft notes: one plain bullet per user-visible change, most important
   first, no headers, no issue numbers, ending with the compare link. Get
   Jacob's approval.
3. On Jacob's explicit "release", tag and publish with `gh release create
   vX.Y.Z --target <main sha> --title "vX.Y.Z - Short Name" --notes-file <file>`.
   Never pass `--generate-notes`: it attributes changes to accounts.
4. Watch the deploy in the background, then confirm the live site reports the
   new build on `/api/health` and the home page loads.
