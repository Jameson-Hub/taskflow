# TaskFlow

A team task board with authentication, role-based access and a Kanban workflow. Runs entirely on Cloudflare's free tier: one Worker serves the React app and the API, and D1 (SQLite) stores the data.

**Live demo:** https://taskflow.bagainjameson.workers.dev. Pick a role to look around the shared demo board, which resets every night at 00:00 UTC, or create an account to get a private workspace of your own.

## Features

- **Kanban board** with drag and drop between and within columns, updating live when anyone in the workspace changes something. An open task updates too: a teammate's change to a field you haven't touched just appears, and if you both changed the same field yours is kept and you're told
- **Undo delete:** a deleted task disappears at once but can be restored for 10 seconds, comments and history intact
- **Keyboard support:** Alt/Option + arrow keys move a focused card (announced to screen readers), N opens a new task, / jumps to search
- **Three roles**, enforced on the server:

  | | Admin | Manager | Member |
  |---|:-:|:-:|:-:|
  | View board, comment | ✓ | ✓ | ✓ |
  | Create tasks | ✓ | ✓ | ✓ (assign to self) |
  | Edit tasks | any | any | own or assigned |
  | Assign to others, delete tasks | ✓ | ✓ | |
  | Activity log | ✓ | ✓ | |
  | Add people, change roles | ✓ | | |

- **Dashboard** with open, overdue and due-this-week counts, average days to finish, finished work per week, a "needs attention" list, the next 14 days, and bar charts of work by status, priority, person and label. Click a bar to open the board filtered to it, or switch to just your own tasks.
- **Activity log** recording who created, changed, moved, deleted or commented on what, and role changes
- **@mentions in comments**, highlighted, with a "Mentions me" filter on the board (no emails to manage)
- **Comments, due dates, priorities, labels, checklists** (progress shown on the card), search and filters
- **Export to CSV**: download the tasks the current filters show, ready for Excel or Google Sheets
- **Sign up for a private workspace**: you become its admin and add your team. Workspaces are fully isolated from each other.
- **Invite links**: an admin creates a single-use link for a role, valid for 7 days, and the person joining picks their own password.
- **Read-only share link**: an admin makes one link to show the board to people outside the team, no sign-in needed. It shows titles, status, priority, assignees, due dates, labels and checklist progress, never descriptions, comments or emails, and can be replaced or turned off.
- **Account settings**: change your password (signs you out everywhere else) or delete your account. A deleted account is anonymised, so the board, comments and activity history stay intact; the last admin leaving deletes the workspace, after confirming.
- **Light and dark themes**: follows the system, or pick one with the topbar button; remembered per browser and applied before the page paints
- **Installable** on phones and desktops (web app manifest, no service worker to go stale), with a phone layout
- **One-click demo logins** for a shared demo board that resets nightly

## Stack

| Layer | Choice |
|---|---|
| Runtime | Cloudflare Workers |
| API | Hono, Zod validation |
| Database | Cloudflare D1 (SQLite), SQL migrations |
| Frontend | React 19, Vite, plain CSS (light and dark) |
| Tests | Vitest inside the Workers runtime, Playwright in a real browser, ESLint |
| CI/CD | GitHub Actions → Wrangler |
| Live updates | Durable Objects (one per workspace, WebSocket hibernation) |

## How it works

```
Browser ──► Worker ─┬─ /api/*     → Hono routes → D1
                    ├─ /api/live  → BoardRoom Durable Object (one per workspace; WebSocket)
                    └─ else       → static React build (SPA fallback)
          Cron 00:00 UTC ──► reset demo workspace, delete inactive ones
```

- **Sessions:** a random 256-bit token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored, so a leaked table can't be used to sign in. Logout deletes the row. "Remember me" keeps a login for 30 days; without it the cookie ends with the browser and the server expires it within a day.
- **Passwords:** PBKDF2-SHA256 with a per-user salt, compared in constant time. Unknown emails still run a hash, so timing doesn't reveal which accounts exist.
- **CSRF:** every non-GET request, and the live WebSocket, must carry an `Origin` header matching the app.
- **Live updates:** a change that shows on the board tells the workspace's Durable Object, which sends each open board a bare "changed" (no data), and the board fetches again through the normal, permission-checked API. Idle connections hibernate, so they cost nothing.
- **Multi-tenancy:** every query is scoped to the caller's workspace, so another workspace's data reads as "not found". Tests prove each endpoint stays inside its workspace.
- **Abuse without upkeep:** sign-up and login are rate-limited per IP, sign-up has a honeypot field, and a nightly job deletes workspaces nobody has used for 30 days. There is no password reset, since that would need an email domain.
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
npm run test:e2e  # browser tests against the built app
```

- **Integration tests** (`test/*.test.ts`) go through the HTTP API the way the app does: sign-in and sessions, CSRF, what each role can and can't do, task and comment rules, share links, reading one task, search, labels, checklists, the dashboard counts, live updates, the activity log and the nightly reset.
- **Unit tests** (`test/unit/`) cover the pure logic on its own: the permission rules, password hashing, where a moved card lands and the CSV export.
- **Browser tests** (`e2e/`, Playwright) click through the built app against a local database: the demo, signing up and finishing a task, the keyboard controls, undoing a delete, @mentions, the CSV download, the theme switch, an open task updating live, joining by invite link, sharing a read-only board, and installability and phone layout. Run them with `npm run test:e2e`; locally they use your installed Chrome.

## Deployment

Every push runs lint, typecheck, tests, build and the browser tests. Pushes to `main` then apply D1 migrations and deploy, only if all of those pass. Pull requests deploy to the separate dev Worker and database, and the PR gets its link.

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
