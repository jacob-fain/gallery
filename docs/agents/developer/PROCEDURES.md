# Developer procedures

## The gate

Run all of it and read each exit code before opening a PR.

```sh
cd backend && npm run typecheck && npm test && npm run build
cd frontend && npm run lint && npm run build
```

Once CI exists, the same steps run on every PR and are required to merge.

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

- When `main` moves and a PR conflicts, merge `main` into the branch, build,
  read the exit code, then push. Never force-push.
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
