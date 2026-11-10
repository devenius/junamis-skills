---
surface_id: api/get-user
kind: api
status: draft
version: 0.1.0
owner: library/develop
code_paths: []
depends_on: []
related_tasks: []
last_reviewed: 2026-11-10
design_checksum: sha256:78aae36100071cc4990928c9a160d5454a0089263c8b0c27346dc243a4333fc5
last_reviewed_commit: 2c5c3d607fbba992c77a5cff83daf7113dd41cf1
---

## Intent

Read one user by id for the profile and account surfaces. The endpoint returns
the public identity fields only; it never returns credentials or secrets.

## Current state

Nothing is implemented yet. This file is the intended contract for the
endpoint: method, path, auth, request, response, errors, and one example. No
code path is claimed until the route exists.

## Known gaps

- Implement `GET /api/users/:id` behind bearer auth and the 100/min limit.
- Decide whether a soft-deleted user is 404 or a distinct error code.
- Add the response contract test before this surface becomes active.

## Endpoint

- Method: `GET`
- Path: `/api/users/:id`
- Auth: `bearer`
- Rate limit: `100/min`

## Request

| field | in | type | required | notes |
|-------|----|------|----------|-------|
| `id` | path | `string(uuid)` | yes | user id |
| `Authorization` | header | `string(bearer)` | yes | access token |

## Response — 200

| field | type | nullable | notes |
|-------|------|----------|-------|
| `id` | `string(uuid)` | no | user id |
| `email` | `string(email)` | no | primary email |
| `createdAt` | `string(iso8601)` | no | account creation time |

## Errors

| status | code | meaning |
|--------|------|---------|
| 401 | `unauthorized` | missing or invalid token |
| 403 | `forbidden` | token is valid but may not read this user |
| 404 | `user_not_found` | id is valid but unknown |

## Examples

```json
{ "id": "5b0f0f0e-0000-4000-8000-000000000001", "email": "a@b.c", "createdAt": "2026-11-10T10:00:00Z" }
```

## Change log

- 2026-11-10 · v0.1.0 · Created draft surface · bootstrap · library/document
