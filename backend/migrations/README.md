# Migrations

`backend/src/migrate.ts` applies these files in order (`node dist/migrate.js`
in the image, `npm run migrate` locally), each in its own transaction, and
records each in `_migrations`.

## Rules

- **Name** a new file `NNN_description.sql` with the next unused number.
  Never edit or rename a file that has shipped: databases that already
  applied it will not run it again.
- **Stay readable by the previous release.** A deploy migrates first, then
  swaps containers, and a failed swap restores the previous images but not
  the previous schema. Every migration must therefore leave a schema the
  release before it still works with:
  - add tables, columns (nullable or with a default) and indexes freely;
  - drop or rename a column or table only in a later release, after no
    running code reads it (expand, then contract);
  - change a column's type or constraints in the same two steps.
- **No transaction control** (`BEGIN`, `COMMIT`) and no statements that
  cannot run inside a transaction, such as `CREATE INDEX CONCURRENTLY`.
- **Test it**: the database tests rebuild a fresh schema with the runner on
  every CI run, so a migration that does not apply to an empty database
  fails CI.
