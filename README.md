# TaskFlow

A team task board with authentication, role-based access and a Kanban workflow. Runs entirely on Cloudflare's free tier: one Worker serves the React app and the API, and D1 (SQLite) stores the data.

**Live demo:** _coming soon_. Pick a role on the login screen to look around. The demo workspace resets every night at 00:00 UTC.

## Features

- **Kanban board** with drag and drop between and within columns
- **Three roles**, enforced on the server:

  | | Admin | Manager | Member |
  |---|:-:|:-:|:-:|
  | View board, comment | ✓ | ✓ | ✓ |
  | Create tasks | ✓ | ✓ | ✓ (assign to self) |
  | Edit tasks | any | any | own or assigned |
  | Assign to others, delete tasks | ✓ | ✓ | |
  | Activity log | ✓ | ✓ | |
  | Add people, change roles | ✓ | | |

- **Activity log** recording who created, changed, moved, deleted or commented on what, and role changes
- **Comments, due dates, priorities**, search and filters
- **One-click demo logins** plus email/password accounts for people an admin adds

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| API | Hono, Zod validation |
| Database | Cloudflare D1 (SQLite), SQL migrations |
| Frontend | React 19, Vite, plain CSS (light and dark) |
| Tests | Vitest running inside the Workers runtime, ESLint |
| CI/CD | GitHub Actions → Wrangler |

## How it works

```
Browser ──► Worker ─┬─ /api/*  → Hono routes → D1
                    └─ else    → static React build (SPA fallback)
          Cron 00:00 UTC ──► reset demo data
```

- **Sessions:** a random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored, so a leaked table can't be used to sign in. Logout deletes the row.
- **Passwords:** PBKDF2-SHA256 with a per-user salt, compared in constant time. Unknown emails still run a hash, so timing doesn't reveal which accounts exist.
- **CSRF:** every non-GET request must carry an `Origin` header matching the app.
- **Authorization** lives in the API. The UI hides what a role can't do, but the server is the authority, and the tests prove it.
- **Ordering:** cards use fractional positions, so a move rewrites one row instead of renumbering the column.
- **Atomic logging:** each change and its activity entry are written in one D1 batch.

## Run it locally

Requires Node 24 (`nvm use`).

```sh
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173. The first demo login seeds the workspace. To reset it, run the same job the nightly cron runs:

```sh
curl -X POST http://localhost:5173/cdn-cgi/handler/scheduled
```

## Tests

```sh
npm test          # tests in the Workers runtime against a real local D1
npm run lint
npm run typecheck
```

- **Integration tests** (`test/*.test.ts`) go through the HTTP API the way the app does: sign-in and sessions, CSRF, what each role can and can't do, task and comment rules, search, the activity log and the nightly reset.
- **Unit tests** (`test/unit/`) cover the pure logic on its own: the permission rules and password hashing.

## Deployment

Every push runs lint, typecheck, tests and build. Pushes to `main` then apply D1 migrations and deploy. Pull requests get a preview URL.

Two things to know:

- **Migrations run before the new code goes live**, so they must be additive (add a column or table, don't rename or drop in the same release). Remove old columns in a later release, once no deployed code reads them.
- **Three databases, never shared:** local (on disk, for `npm run dev` and tests), dev (pull-request previews) and prod. Each is its own D1 database; dev and prod are separate Workers defined in `wrangler.jsonc`.

One-time setup:

1. `npx wrangler login`
2. `npx wrangler d1 create taskflow` and `npx wrangler d1 create taskflow-dev`, and put each returned `database_id` in `wrangler.jsonc`
3. In the GitHub repo settings, add secrets `CLOUDFLARE_API_TOKEN` (Workers and D1 edit permissions) and `CLOUDFLARE_ACCOUNT_ID`

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`, at most 72 characters. CI rejects anything else.

```
feat(board): add drag and drop between columns
fix(auth): reject logins with no Origin header
test(policy): add unit tests for role rules
```

Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`.

## License

MIT © Jameson Bagain
