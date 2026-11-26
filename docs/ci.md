# CI

CI runs on self-hosted, containerized, ephemeral runners on a box of their
own, not on GitHub-hosted runners and not on the production server. Each
runner takes one job, then is replaced. The production server keeps its own
runner for the "Release and Deploy" workflow until the pull deploy
(`deploy/README.md`) replaces it.

## Runners

| Labels | Kind | Runs |
| --- | --- | --- |
| `self-hosted, linux, ci, ci-light` | light | path filters, backend and frontend lint, typecheck, unit and database tests, secret scan, deploy-script checks, the `*-ok` aggregators, deployment records |
| `self-hosted, linux, ci, ci-build` | build | E2E (docker compose plus Playwright), image builds |
| `self-hosted, prod-deploy` | production server | `atomic-release-deploy.yml` only |

Both CI kinds have their own `docker:dind` sidecar. `DOCKER_HOST` points at
it; there is no host Docker socket. The production runner needs the
`prod-deploy` label because the CI runners are self-hosted too: a deploy that
asked only for `self-hosted` could land on a CI runner.

### What the runner setup must provide

The workflows rely on these. A missing one fails the job that needs it with a
plain error (command not found, connection refused, missing file).

- The runner container shares the dind sidecar's network namespace. Ports
  that service containers and the E2E stack publish on `127.0.0.1` must be
  reachable at `localhost` from the job.
- The runner's work directory is mounted into the sidecar at the same path.
  The secret scan and the E2E stack bind-mount files from the checkout.
- In the image: `git` 2.18 or later (without it `actions/checkout` downloads
  a tarball, and the full-history secret scan breaks), the Docker CLI with
  the `compose` and `buildx` plugins, `curl`, `jq`, `openssl`, `python3`,
  `shellcheck`, and, on `ci-build`, the system libraries Chromium needs for
  Playwright 1.65.1 (`npx playwright@1.65.1 install-deps chromium` while
  building the image).
- The local CA that signed `registry.lan` at
  `/usr/local/share/ca-certificates/registry-lan.crt` and in the system trust
  store (`update-ca-certificates`), and in the sidecar at
  `/etc/docker/certs.d/registry.lan/ca.crt`. BuildKit gets the first path
  through its own config (`REGISTRY_CA` in `images.yml`); change it there if
  the file lives elsewhere.
- `registry.lan` resolves inside the sidecar. Builders run with host
  networking inside dind, so the sidecar's resolver is the one that counts.
- Persistent named volumes for the npm cache (mounted at the runner user's
  `~/.npm`, or wherever `npm_config_cache` points) and for Playwright
  browsers (`PLAYWRIGHT_BROWSERS_PATH` set in the runner environment).

## What runs where

| Workflow | Job | Runner | Pull request | Push to main | Tag `v*` |
| --- | --- | --- | --- | --- | --- |
| CI | `changes` | light | always | always | |
| CI | `backend` | light | backend or shared files changed | always | |
| CI | `frontend` | light | frontend or shared files changed | always | |
| CI | `secret-scan` | light | always | always | |
| CI | `deploy-scripts` | light | `deploy/` or shared files changed | always | |
| CI | `ci-ok` | light | always | always | |
| E2E | `smoke` | build | backend, frontend, `e2e/` or shared files changed | always | |
| E2E | `e2e-ok` | light | always | always | |
| Images | `build backend`, `build frontend` | build | that app or shared files changed; never pushes | both, pushed | none |
| Images | `deploy` | light | | staging, if `PULL_DEPLOY_ENABLED` | production, if `PULL_DEPLOY_ENABLED` |
| Images | `mirror-ghcr` | light | | | if `GHCR_MIRROR` |
| Images | `images-ok` | light | always | always | always |

Manual runs (`workflow_dispatch`) run every job, like a push to main.

"Shared" files are workflows, `.github/scripts/`, `.github/path-filters.yml`,
`.nvmrc` and every compose file. They can change how any job behaves, so
they run everything. The groups live in `.github/path-filters.yml`, read by
`dorny/paths-filter` (pinned to a commit) in each workflow's `changes` job.
Path filters apply to pull requests only: every main commit gets the full
run and both images, because a release promotes the images of one exact main
commit.

## Required checks

Require exactly these three:

- `ci-ok`
- `e2e-ok`
- `images-ok`

Each runs on every pull request and every push, even when the jobs it needs
failed or were skipped. A job that the path filter skipped counts as passed;
a failed or cancelled one fails the aggregator. Requiring the individual jobs
instead would block every pull request that skips one of them, since a
skipped job never reports.

While the runners are offline, every check stays queued, so the merge gate
holds the pull request.

## Concurrency

A push to a pull request cancels that pull request's run in flight. Every
other run (main, tags, manual runs) has a group of its own, keyed by ref and
commit, and is never cancelled. A shared group would not be enough: GitHub
keeps one pending run per group and drops the older pending one when a third
arrives, which would leave a main commit without images.

Because main runs are not serialized, an older commit's build can finish
after a newer one's. The staging deployment therefore checks that its commit
is still the head of main; if not, it records nothing and the newer run
deploys staging itself.

## Caches

- npm: on the persistent volume. `actions/setup-node` downloads Node (no
  GitHub toolcache is assumed) and does not use the Actions cache on
  self-hosted runners, which would only add a download and an upload.
  `npm ci` installs from the warm cache.
- Playwright: browsers live on the `PLAYWRIGHT_BROWSERS_PATH` volume. The
  version is pinned exactly in `e2e/package.json`, so the volume holds one
  known browser build and a download happens only when the pin changes.
- Docker layers: each image's BuildKit cache lives in the registry at
  `registry.lan/gallery-<app>:buildcache` (`mode=max`). Only main runs write
  it. Pull requests read it if the registry allows anonymous pulls; otherwise
  they build cold, which is a warning, not a failure. A failed cache write
  never fails a build.

The E2E stack builds its images with plain `docker compose build` inside the
sidecar, so its layer cache lasts only as long as the sidecar's storage.

## Registry

- Images: `registry.lan/gallery-frontend` and `registry.lan/gallery-backend`.
  Main pushes `sha-<full commit>` and `main` tags; a release adds the `v*`
  tag to the same digest.
- The deploy path names images only by digest. `images.yml` writes each
  digest to the job summary and to a `digest-<app>` artifact, and the
  `deploy` job puts both in the GitHub Deployment payload
  (`frontend_digest`, `backend_digest`). The server's poller passes them to
  `homelab-gallery-apply`, which pulls `registry.lan/gallery-<app>@<digest>`
  and refuses anything that is not `sha256:` plus 64 hex characters.
- Only main logs in. Pull requests, Dependabot and branch runs never log in
  and never push, and Dependabot runs get no secrets at all. A main run
  without the registry credentials fails rather than skipping the push: a
  main commit with no images can never be released.
- `mirror-ghcr` copies a release's two images to
  `ghcr.io/jacob-fain/gallery-<app>:<version>` as an off-box copy. Nothing
  deploys from it. It is off unless `GHCR_MIRROR` is `true`, and private GHCR
  storage counts against the account's package quota.

## Secrets and variables

| Name | Kind | Purpose |
| --- | --- | --- |
| `REGISTRY_USER`, `REGISTRY_PASSWORD` | secret | push credential for `registry.lan`, CI only |
| `RUNNER_MODE` | variable | `hosted` sends every CI job to GitHub-hosted runners; unset means self-hosted |
| `PULL_DEPLOY_ENABLED` | variable | `true` records staging and production deployments |
| `GHCR_MIRROR` | variable | `true` copies release images to GHCR |

## Adding a job

1. Pick the runner: `ci-light` unless the job builds images or runs the E2E
   stack. Copy the `runs-on` expression from a job of that kind, so the
   hosted fallback keeps working.
2. If it applies only to part of the tree, add `needs: changes` and an `if:`
   on the right `changes` output, adding a group to `.github/path-filters.yml`
   if none fits.
3. Add it to the `needs` of the workflow's `*-ok` job. A job left out of it
   can fail without blocking a merge.
4. Do not declare an `environment`. Use `actions/setup-node` with
   `cache: ${{ vars.RUNNER_MODE == 'hosted' && 'npm' || '' }}`.
5. Pin third-party actions to a commit, with the version in a comment.
6. Run `actionlint` before pushing.

## Falling back to GitHub-hosted runners

Set the repository variable `RUNNER_MODE` to `hosted`. Every CI job's
`runs-on` then evaluates to `ubuntu-latest`, `setup-node` uses the Actions
cache, Playwright installs its system libraries, and image builds use the
Actions cache instead of the registry. Delete the variable to go back.

In hosted mode GitHub's runners cannot reach `registry.lan`, so images build
but are never pushed, and the `deploy` and `mirror-ghcr` jobs do not run. CI
and E2E still gate merges; releases wait for the self-hosted runners. Hosted
runs use Actions minutes.
