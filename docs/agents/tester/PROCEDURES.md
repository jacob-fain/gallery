# Tester procedures

`R=repos/jacob-fain/gallery` below.

## Check a PR

1. `gh pr view <n>` and `gh pr diff <n>`. Read the whole diff.
2. Check out the exact head in its own worktree. Use the full sha from
   `gh pr view <n> --json headRefOid --jq .headRefOid`, not `FETCH_HEAD`,
   which another fetch can move between the two commands:
   `git fetch origin pull/<n>/head && git worktree add --detach .claude/worktrees/test-<n> <sha>`.
   Confirm `git -C .claude/worktrees/test-<n> rev-parse HEAD` matches before testing.
3. Run the gate there (`docs/agents/developer/PROCEDURES.md`) and read each
   exit code. Run any test the PR adds and confirm it fails without the fix
   when that is cheap to show (revert the fix line locally, run, restore).
4. For a UI change, run the targeted browser check below.
5. Post the verdict, then remove the worktree.

## Targeted browser check

- Start Postgres with `docker compose up -d`, then the backend and frontend
  from the PR worktree on ports nobody else is using.
- Uploads and deletes reach the S3 bucket in the backend's `.env`. Never run
  them unless that bucket is a dev bucket production does not use. If unsure,
  check only read paths and say so in the verdict.
- Check only what the PR changed, at the fewest widths that prove it (usually
  375px and 1280px), as the role that sees it (visitor or admin).
- Read numbers, not just screenshots: computed styles, element boxes, console
  errors. A page that throws is a failure, never a flake.
- Fail a PR for: horizontal scroll on a phone, text that needs zoom, state
  shown by color alone, missing alt text on new images, a console error, em
  dashes or emojis in UI text.

## The merge

Merge when the merge rule in `docs/agents/README.md` holds. Merge through the
API, pinned to the head you tested:

```sh
gh api -X PUT $R/pulls/<n>/merge -f merge_method=squash -f sha=<full head sha> \
  -f commit_title="<PR title> (#<n>)"
```

A 405 or 409 means a check is pending, the head moved, or a conflict exists:
re-read, never work around it. Confirm `main` moved, then post
`Test: MERGED <main sha>`.

## Infrastructure versus a real failure

Read the failing assertion before deciding. A tool-install timeout is
infrastructure: rerun the failed jobs. A failure that reproduces on a rerun is
real.
