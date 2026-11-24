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
   - takes `/run/lock/homelab-gallery.lock` (shared with the backup and
     update night);
   - pulls both images by digest and reads the expected build id from the
     backend image;
   - runs migrations from the new image (`node dist/migrate.js`);
   - swaps containers;
   - waits for `/api/health/ready` on localhost to report that build id.

   A failed start or a build that never reports ready puts the previous
   images back.
5. The poller posts success or failure on the deployment. A failed production
   deploy also alerts through `homelab-notify`.

Rollback is a deployment of the previous tag.

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

Sudoers, the only privilege `gallery-deploy` has:

```
gallery-deploy ALL=(root) NOPASSWD: /usr/local/sbin/homelab-gallery-apply
```

GHCR pull credentials live in root's Docker config (`docker login ghcr.io`
with a read:packages token), so they never pass through the poller.

## First production cutover

1. Confirm `_migrations` lists 001 to 010 and the schema matches (checked
   2026-11-24: all ten recorded, the columns and tables they add exist).
2. Take a fresh `pg_dump` of `gallery-db-1`.
3. Install the files above. Copy today's `.env.production` to
   `/opt/docker/gallery/` (root 0600).
4. Stop the old stack from `/home/jacob/gallery` with `docker compose down`,
   not `down -v`, so the `gallery_postgres_data` volume stays.
5. Create the first production deployment. Its migrate step should report
   "Database is up to date".
6. Confirm the site and `/api/health/ready`. Then retire the self-hosted runner
   and `/home/jacob/gallery`.

## Open items before staging goes live

- Staging needs its own S3 bucket (the app writes keys at the bucket root),
  plus its own database password and JWT secret.
- A cloudflared ingress rule for `staging.jacobfain.gallery` above the
  wildcard, a DNS route, and Cloudflare Access (Jacob's email only).
