---
name: db-migrate
version: "1.0.0"
description: Use when a schema change or data migration is needed (add, rename, or drop columns or tables, backfill data, change constraints). Uses expand and contract so old and new code both run during deploy, writes reversible migration files with the project's own migration tool, and rehearses on a copy first. Do not use to run migrations against production; the user runs those after review.
---

# db-migrate

Write a migration that is safe to deploy while the old code is still running, and prove it on a copy.

## Steps

1. **Find the tool.** Detect the project's migration tool from its config and existing migration folder (for example Prisma, Drizzle, Knex, TypeORM, Alembic, Flyway). Use that tool. Do not introduce a second one.
2. **Classify the change.**
   - Additive (new nullable column, new table, new index concurrently): one migration.
   - Breaking (rename, drop, type change, new NOT NULL): expand, migrate code, contract, in separate releases.
3. **Write the migration.** Include an up and a down. If the down is destructive (data loss), say so in a comment and in the handoff.
4. **Backfill separately.** Large data changes go in a batched script, not in the schema migration. Batch size and a resume point must be stated.
5. **Rehearse.** Run up, then down, then up again against a local or copied database. The down step deletes data, so show the user the exact commands and get approval first (see `~/.junamis/library/SAFETY.md`). Record the result. If no database is available, set `status: blocked` and say what is needed.
6. **Write the rollback note.** One paragraph: what a rollback restores, and whether any data written after deploy is lost.

## Gotchas

- Dropping a column that the currently deployed code reads causes an outage. Contract only after the code stops reading it.
- `CREATE INDEX` without concurrency locks writes on large tables. Use the concurrent form where the database supports it.
- A down migration cannot restore dropped data. Say so. Do not pretend it can.
- Never edit a migration that has already run anywhere. Write a new one.
- Do not run migrations against any environment named production, staging, or live from this skill.

## Finish

```yaml
agent: db-migrate
job: migrate <change>
status: complete | blocked | needs-decision | failed
artifacts:
  - path: <migration file>
    kind: created
findings:
  - id: F1
    severity: critical
    summary: rollback loses data written after deploy
    evidence: <migration file:line>
decisions_owed:
  - accept irreversible data loss on rollback?
next: user
```

Always set `next: user`. A person reviews and runs migrations. Use `status: needs-decision` when a destructive step needs approval.
