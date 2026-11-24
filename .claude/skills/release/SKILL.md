---
name: release
description: Cut a tagged production release of the gallery. Gathers what merged since the last tag, drafts release notes in the standard format, gets Jacob's approval, creates the GitHub release (its v* tag promotes the images main already built and deploys them to production), and verifies the live site. Use when Jacob says to release, ship, or cut a version, or runs /release.
---

# /release: cut a production release

A release tags a commit on `main` and publishes a GitHub release. The `v*` tag
makes `.github/workflows/images.yml` promote the images built for that exact
commit (the ones staging already ran) and record a production deployment,
which the home server applies within about a minute (`deploy/README.md`). The
release notes are the changelog.

A release is a production deploy. It needs Jacob's explicit word every time.

## 1. Preconditions (stop and say why if any fails)

- `git fetch origin` and work from `origin/main`.
- The newest CI and Images runs on `main` are green:
  `gh run list --branch main --limit 4`.
- No open PR is planned for this release unless Jacob says to leave it out.
- The `PULL_DEPLOY_ENABLED` repository variable is `true`. Until the pull deploy
  is installed, production still deploys through the old "Release and
  Deploy" workflow instead, which creates its own tag; do not tag by hand
  then.

## 2. Version

- Last tag: `git describe --tags --abbrev=0 origin/main`.
- Propose the next patch version unless Jacob asks for a minor or major one.

## 3. Raw material

- `git log --oneline <lastTag>..origin/main`
- `gh pr list --state merged --limit 50 --json number,title,body,mergedAt`,
  kept to merges after the last tag's date.

## 4. Draft the notes in exactly this shape

```
- One user-visible change, in plain language, with why it matters.
- The next change. One per bullet.

Full changelog: https://github.com/jacob-fain/gallery/compare/<lastTag>...<version>
```

- Bullets only: no lead paragraph, no headers, no category labels.
- Most significant first. Only real changes, no filler.
- No issue or PR numbers, no commit references, no internal plumbing a
  visitor or admin cannot notice.
- Security fixes are always listed, stated specifically without exploit
  detail ("Private gallery photos can no longer be fetched without the
  gallery's password").
- No em dashes, no emojis, no personal names or handles, complete sentences.
- Title: `vX.Y.Z - Two To Four Word Name`.
- Steps Jacob has to take (sign in again, settings to change) go in the
  message to Jacob, never in the published notes.

## 5. Confirm

Show Jacob the version, title and full notes, and wait for an explicit yes.

## 6. Release

```sh
gh release create vX.Y.Z --target <full origin/main sha> \
  --title "vX.Y.Z - Name" --notes-file <file>
```

Never pass `--generate-notes`: it attributes changes to accounts.

## 7. Verify

- Watch the Images run for the tag in the background
  (`gh run watch <id> --exit-status`). Its summary names the deployment.
- Within a few minutes, the deployment shows `success`
  (`gh api repos/jacob-fain/gallery/deployments?environment=production&per_page=1`,
  then its `statuses_url`).
- Independently: `https://jacobfain.gallery/api/health/ready` answers ok with
  a new build id, and the home page loads.
- Report the release URL and the result to Jacob. If the deployment failed,
  read its status description (the server's one-line reason) before
  suggesting anything. A rollback is a release of the previous version's
  commit, or a deployment of its digests.
