# CLAUDE.md

Rules for every agent session working in this repository.

## Writing style, always

- Never use em dashes. Use commas, periods, colons, or parentheses.
- Never use emojis: not in code, docs, commit messages, PR bodies, issues, or chat.
- Never credit an AI as an author. No co-author trailers, no "generated with"
  footers, no session links, nothing similar in commits, PRs, issues, comments,
  or release notes. Everything posts as Jacob's account and reads as his.
- PR titles and bodies, issue titles and bodies, and commit messages describe
  the change itself and stand alone for a reader with no context: what changed,
  in the codebase's terms, and why it matters. Never reference the
  conversation they came from (no "as discussed", no names, no dates of
  decisions, no review rounds).
- Comments state what the code cannot say: the invariant, the constraint, the
  reason for a non-obvious choice. Never narrate what the code does.

Examples and the full guide: `docs/agents/WRITING.md`.

## Workflow

- Never commit to `main`. Branch from `origin/main` in a git worktree under
  `.claude/worktrees/<name>`, and open a PR with `gh`.
- Every change starts from an issue. Close it from the PR with `Closes #N`.
- Two agent roles: the developer builds, the tester verifies and merges. The
  developer never merges its own PR. Roles and procedures: `docs/agents/`.
- Run the gate before opening a PR (`docs/agents/developer/PROCEDURES.md`).
- When `main` moves under an open PR, merge `main` into the branch. Never
  force-push a branch that has been pushed.
- Releases are tagged and need Jacob's explicit word. The release notes are the
  changelog.
- Ask Jacob before expanding scope. Decisions with real alternatives go to him
  with options and a recommendation; UI changes get a mockup first.
- Keep working between Jacob's messages. Wait on CI or long commands with a
  background command, not by ending the turn.

## Production and the server

- Production runs on Jacob's home server, which a separate homelab agent
  session owns. Never change the server (Docker, reverse proxy, tunnel,
  backups, users, ports) from this repository's work. Coordinate with that
  session and get Jacob's OK first.
- The database container, user, and database are all named for the backup job
  (`gallery-db-1`, `gallery`, `gallery`). Do not rename them without telling
  the homelab session.
- `/api/health` is watched by uptime monitoring. Keep the path stable.
- Secrets never go in the repository, issues, or logs. Point to where a
  credential lives, never its value.

## Project

A photography portfolio with private client galleries.

- `frontend/`: React 19 + Vite SPA. The admin UI is the same bundle, served on
  the `manage.` subdomain (`src/utils/subdomain.ts`).
- `backend/`: Express 5 + TypeScript API. Routes, controllers, services
  (`src/routes`, `src/controllers`, `src/services`). Only the backend talks to
  Postgres and S3.
- `db/init/`: SQL migrations, applied in filename order.
- Photos live in a private S3 bucket and are served through presigned URLs, in
  three sizes per photo (original, web, thumbnail).

Local dev: `docker compose up -d` for Postgres, then `npm run dev` in
`backend/` and `frontend/`. The admin UI runs at `http://localhost:5173/?admin=true`.

The audit backlog is indexed in issue #114. Security-sensitive findings are
tracked as private security advisories, not public issues.
