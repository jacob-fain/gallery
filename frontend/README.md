# Frontend

React 19 + Vite single-page app. The public site and the admin UI are the
same bundle: the admin UI loads when the hostname starts with the admin
subdomain (`manage.` by default, see `src/utils/subdomain.ts`).

## Run it

Start Postgres and the backend first, from the repository root:

```sh
docker compose up -d db
(cd backend && npm ci && npm run migrate && npm run dev)
```

Then, in `frontend/`:

```sh
npm ci
npm run dev
```

The dev server listens on `127.0.0.1:5173`, so only this machine can reach it.
To open it from another device, start it with `VITE_HOST=0.0.0.0 npm run dev`.
Over plain HTTP the app calls the API at
`http://<same host>:3001/api`; over HTTPS it uses `/api` on the same origin.
Set `VITE_API_URL` to point it somewhere else.

To open the admin UI locally, use `http://manage.localhost:5173`, or add
`?admin=true` to any dev URL (remembered for the browser session).

## Checks

```sh
npx eslint . --max-warnings 0
npm test
npm run build
```

These are the frontend half of the checks CI runs on every pull request
(`.github/workflows/ci.yml`).

## Layout

- `src/pages`: one component per route.
- `src/components`: shared UI.
- `src/api/client.ts`: every call to the backend, with a short in-memory cache.
- `src/contexts`: auth and theme state.
- `nginx.conf`, `security-headers.conf`: how the production container serves
  the build.
