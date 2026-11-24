# Pull-based deploys

Production and staging run on the home server. Images are built on GitHub's
runners (`.github/workflows/images.yml`) and the server pulls them; nothing on
GitHub can connect to or run code on the server. The homelab session installs
and owns everything in this folder on the host; changes to it are reviewed
here as host code first.

## How a release reaches the server

1. A merge to `main` (staging) or a `v*` tag (production) builds both images
   and pushes them to GHCR. The release workflow then records a GitHub
   Deployment whose payload holds the two image digests. Production
   deployments wait for Jacob's approval in the `production` environment.
2. `gallery-deploy-poll` (systemd timer, every minute, user `gallery-deploy`)
   asks GitHub for the newest deployment of each environment, using an ETag so
   an unchanged answer is free.
3. For a deployment nobody has answered, it runs
   `sudo /usr/local/sbin/homelab-gallery-apply <prod|staging> <frontend-digest> <backend-digest>`.
4. The wrapper:
   - takes `/run/homelab-gallery.lock` (shared with the backup and update
     night; `/run` is root-only, so no other user can hold it);
   - pulls both images by digest and reads the expected build id from the
     backend image;
   - for production, takes a verified `pg_dump` into
     `/var/backups/gallery-predeploy/` (newest 10 kept), aborting if it fails;
   - runs migrations from the new image (`node dist/migrate.js`);
   - swaps containers;
   - waits for `/api/health/ready` on localhost to report that build id.

   A failed start or a build that never reports ready puts the previous
   images back.
5. The poller posts success or failure on the deployment. A failed production
   deploy also alerts through `homelab-notify`.

Rollback is a deployment of the previous tag. It restores images, not the
schema, so migrations must stay readable by the previous release
(`backend/migrations/README.md`); the pre-deploy dump covers anything worse.

Only the newest deployment of each environment is considered. A deployment
that a newer one supersedes while still queued is skipped on purpose: the
newer one carries the release that should run.

## Files

| Repo path | Installed as | Owner, mode |
| --- | --- | --- |
| `host/homelab-gallery-apply` | `/usr/local/sbin/homelab-gallery-apply` | root:root 0755 |
| `host/gallery-deploy-poll` | `/usr/local/lib/gallery-deploy/poll` | root:root 0755 |
| `systemd/gallery-deploy-poll.service`, `.timer` | `/etc/systemd/system/` | root:root 0644 |
| `compose/prod.yml` | `/opt/docker/gallery/docker-compose.yml` | root:root 0644 |
| `compose/staging.yml` | `/opt/docker/gallery-staging/docker-compose.yml` | root:root 0644 |

Each compose directory also holds:

- `.env.production` (root 0600): the same variables as today's file. Staging's
  has its own database password, JWT secret and S3 bucket.
- `pinned.env`, written by the wrapper.

Sudoers, the only privileges `gallery-deploy` has:

```
Defaults!/usr/local/sbin/homelab-gallery-apply !requiretty
gallery-deploy ALL=(root) NOPASSWD: /usr/local/sbin/homelab-gallery-apply
gallery-deploy ALL=(root) NOPASSWD: /usr/local/sbin/homelab-notify
```

Host paths outside the compose directories (all root-owned):

| Path | Mode | Holds |
| --- | --- | --- |
| `/etc/homelab/gallery-deploy.env` | 0600, owned by `gallery-deploy` | `GITHUB_TOKEN` for the poller |
| `/etc/homelab/gallery-docker/` | 0700 | GHCR pull login (`DOCKER_CONFIG=... docker login ghcr.io` with a read:packages token) |
| `/var/backups/gallery-predeploy/` | 0700 | verified dumps taken before each production migration |
| `/run/homelab-gallery.lock` | root | the shared lock |

The wrapper sets `DOCKER_CONFIG`, which also changes where the Docker CLI
looks for plugins, so the compose plugin must be installed system-wide
(`docker-compose-plugin` from Docker's apt repository puts it in
`/usr/libexec/docker/cli-plugins`). The wrapper checks this first.

The poller's systemd sandbox (`ProtectHome`, `ProtectSystem=full`) also
applies to the commands it runs through sudo, which is why none of these
paths are under `/root` or `/home`.

## First production cutover

The new compose file uses the project name `gallery`, the same one the
current stack in `/home/jacob/gallery` runs under. The first deploy
therefore adopts the running containers and the `gallery_postgres_data`
volume in place. The old stack must stay up until then, because the wrapper
dumps the running database before migrating.

1. Confirm `_migrations` lists 001 to 010 and the schema matches (checked
   2026-11-24: all ten recorded, and the columns and tables they add exist).
   The first runner pass should report "Database is up to date".
2. Install the files and paths above. Copy today's `.env.production` to
   `/opt/docker/gallery/` (root 0600). Log in to GHCR into
   `/etc/homelab/gallery-docker`.
3. Leave the current stack running; do not `docker compose down` it.
4. Create the first production deployment. The wrapper:
   - dumps the database to `/var/backups/gallery-predeploy/`;
   - runs migrations ("Database is up to date");
   - recreates the three containers from the pinned images, with the same
     names and the same volume;
   - waits for the new build on `/api/health/ready`.
5. Confirm the site, then retire the self-hosted runner and
   `/home/jacob/gallery`. Its compose file now describes containers it no
   longer owns, so do not run it again.

Tested 2026-11-24 with a copy of today's compose file running and seeded the
way production was. The first deploy adopted it, reported "up to date", and
kept existing rows. A second deploy upgraded it, with a verified dump each
time.

## Open items before staging goes live

- Staging needs its own S3 bucket (the app writes keys at the bucket root)
  and its own IAM user limited to that bucket, both created by Jacob, plus
  its own database password and JWT secret in its `.env.production`.
- A cloudflared ingress rule for `staging.jacobfain.gallery` above the
  wildcard, a DNS route, and Cloudflare Access (Jacob's email only).
