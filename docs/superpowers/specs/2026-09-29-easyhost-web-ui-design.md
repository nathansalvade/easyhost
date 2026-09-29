# EasyHost — Web UI Design (Step 2)

Date: 2026-09-29
Status: Draft — awaiting owner review

## Intent

EasyHost is for people who self-host at home and do not want to live on the
command line. Step 1 delivered a backend API. This step delivers the web
interface on top of it, plus the backend additions the interface needs:
login, a catalog of ready-made apps, persistent app data, and background
installs.

The typical user runs EasyHost on a headless mini-PC, Raspberry Pi or NAS and
manages it from a laptop or phone on the same home network.

### Success criteria

- After installing EasyHost, a user can install, open, start, stop, inspect
  and remove an app without ever touching a terminal.
- The interface is reachable from any device on the home network and is
  protected by a password.
- A forgotten password can be recovered from the interface with the recovery
  code, and every step of that flow is covered by automated tests.
- App data survives stopping, restarting and removing an app unless the user
  explicitly deletes it.
- No first-run tutorial: the only first-run screens are "create password" and
  "your recovery code"; after that, the empty Home screen itself guides the
  user.
- Backend and frontend typecheck, lint, test and build pass in CI.

### Decisions taken by the project owner

| Question | Decision |
|---|---|
| Access | From the home network, protected by a login |
| Choosing what to install | Catalog of ready-made apps, plus an Advanced custom-image form |
| App data | Saved automatically per app; kept on removal unless the user opts in to delete it |
| Opening apps | Each app at `http://<server-IP>:<port>`; the UI shows the address with Open / Copy |
| Accounts | A single administrator account |
| Forgotten password | Recovery code shown at setup; strongly recommended to save, not forced |
| Transport | Plain HTTP on the home network; HTTPS via an optional reverse proxy |
| UI architecture | React SPA served by the existing Express server, same port as the API |
| Navigation | Left sidebar: Home, Add, Settings (bottom bar on phones) |
| Language | English only |
| Privacy | No telemetry, no external requests from the UI; catalog and icons ship with EasyHost |

## Architecture

    src/                      existing backend (Step 1)
      auth/                   new: account, sessions, recovery, rate limiting
      catalog/                new: loads and validates catalog entries
      ...
    catalog/
      <app-id>.json           one file per catalog app
      icons/<app-id>.svg      bundled icons
    web/                      new: React + TypeScript + Vite
      src/
        api/                  fetch client, error-code -> message table
        pages/                Setup, RecoveryCode, Login, Recover, Home,
                              AppDetail, Add, Settings
        components/           Sidebar, AppCard, StatusBadge, LogViewer, ...

- `npm run build` builds the backend and `web/` into static files.
- Express serves the SPA from `web/dist` on `/` and the API on `/api`, on the
  same port (default 3000). Any non-`/api` GET falls back to `index.html`.
- In development, Vite runs on its own port and proxies `/api` to the backend.
- The server now listens on the home network. `app.listen` uses `HOST`
  (default `0.0.0.0`) instead of the hard-coded `127.0.0.1` of Step 1, because
  every `/api` route except the auth bootstrap routes now requires a session.

### New configuration

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Address the UI/API listens on; `127.0.0.1` restricts it to the server |
| `TRUST_PROXY` | `false` | Set when behind an HTTPS reverse proxy; enables `Secure` cookies and correct client IPs |
| `DATA_DIR` | `./data` | Where app data folders are created |

`CONTAINER_BIND_ADDRESS` from Step 1 is unchanged (default `0.0.0.0`).

## Authentication

### Model

    model Account {
      id               Int      @id @default(1)
      passwordHash     String
      recoveryCodeHash String
      createdAt        DateTime @default(now())
      updatedAt        DateTime @updatedAt
    }

    model Session {
      id         String   @id        // SHA-256 of the session token
      createdAt  DateTime @default(now())
      lastUsedAt DateTime @default(now())
      expiresAt  DateTime
    }

- Passwords are hashed with Node's built-in `scrypt` and a per-hash random
  salt; comparison is constant-time. No native dependency.
- Minimum password length: 10 characters.
- The recovery code is 20 random characters from an unambiguous alphabet
  (no `0/O`, `1/I/L`), shown as four groups of five (`K7QX2-...`), about
  100 bits of entropy. It is stored only as a `scrypt` hash.
- Session tokens are 32 random bytes, sent as an `HttpOnly`, `SameSite=Strict`
  cookie (`Secure` when `TRUST_PROXY` is set). Only their SHA-256 is stored.
  Sessions last 30 days and are extended on use.

### Endpoints

| Method | Path | Auth | Behaviour |
|---|---|---|---|
| GET | `/api/auth/status` | none | `{ setupRequired, authenticated }` |
| POST | `/api/auth/setup` | none | `{ password }`; only when no account exists; creates it, starts a session, returns `{ recoveryCode }` |
| POST | `/api/auth/login` | none | `{ password }`; starts a session |
| POST | `/api/auth/logout` | session | ends the current session |
| POST | `/api/auth/recover` | none | `{ recoveryCode, newPassword }`; sets the password, replaces the recovery code, ends all sessions, starts a new one, returns `{ recoveryCode }` |
| POST | `/api/auth/password` | session | `{ currentPassword, newPassword }`; ends all other sessions |
| POST | `/api/auth/recovery-code` | session | `{ password }`; returns a new `{ recoveryCode }`, invalidating the old one |

- `recover` runs in a single database transaction: verify the code, write the
  new password and the new code hash, delete all sessions. Two concurrent
  requests with the same code cannot both succeed.
- A wrong code and an already-used code produce the same response.

### Rate limiting

In memory, keyed by client IP, with separate counters for login and
recovery. After 5 consecutive failures, each further attempt must wait
an exponentially growing delay (starting at 30 s, capped at 15 min);
responses carry the remaining seconds. A success resets the counter.

### Protecting the API

- An auth middleware guards every `/api` route. The only unauthenticated
  routes are `GET /api/auth/status`, `POST /api/auth/setup`,
  `POST /api/auth/login`, `POST /api/auth/recover` and `GET /health`.
- State-changing requests must be `application/json`; together with
  `SameSite=Strict` this closes cross-site request forgery.

## Catalog

Each `catalog/<id>.json`:

    {
      "id": "jellyfin",
      "name": "Jellyfin",
      "description": "Stream your movies, shows and music to any device.",
      "category": "Media",
      "icon": "icons/jellyfin.svg",
      "image": "jellyfin/jellyfin:<pinned version>",
      "containerPort": 8096,
      "defaultHostPort": 8096,
      "env": {},
      "volumes": [
        { "name": "config", "containerPath": "/config" },
        { "name": "cache",  "containerPath": "/cache" },
        { "name": "media",  "containerPath": "/media" }
      ]
    }

- Validated with Zod at startup; an invalid entry prevents startup and fails CI.
- Image tags are pinned to a specific version; `:latest` is rejected.
- Categories: Media, Files, Smart home, Monitoring.
- `GET /api/catalog` returns the entries; icons are served as static files.

Initial catalog, limited to apps that work with a single port over plain
HTTP: Jellyfin, Audiobookshelf, Nextcloud, File Browser, Home Assistant,
Uptime Kuma. Exact image versions are chosen and checked during
implementation.

Deliberately excluded for now: Vaultwarden (its web vault requires HTTPS),
Pi-hole (needs port 53 and extra network privileges), and multi-container or
multi-port apps such as Immich or Syncthing.

## App data

- `App` gains `catalogId String?`, `volumes String` (JSON array of
  `{ name, containerPath }`, default `[]`) and `lastError String?`.
- Each volume is bind-mounted from `DATA_DIR/apps/<app id>/<volume name>`.
  The app id, not the name, is used so folder names are always safe.
- Custom-image apps have no volumes unless added in the Advanced form
  (container paths only; host paths are always EasyHost-managed).
- `DELETE /api/apps/:id` keeps the data folder. `?deleteData=true` also
  deletes it, after checking that the resolved path is inside
  `DATA_DIR/apps/`. If that deletion fails, the app is still removed and the
  response reports the folder that could not be deleted.

Known limitation: apps cannot yet use folders that already exist on the
server (for example an existing movie collection for Jellyfin). Users put
files in the app's data folder. Mapping existing folders is future work.

## App lifecycle changes

- `POST /api/apps` accepts either `{ catalogId, name?, hostPort? }` or the
  Advanced shape `{ name, image, hostPort, containerPort?, env?, volumes? }`.
  It validates, reserves the name and port, creates the row as `PENDING`,
  and returns `202` with the row. Pull, create and start continue in the
  background and end in `RUNNING`, or in `ERROR` with a human-readable
  `lastError`.
- On startup, any row still `PENDING` is set to `ERROR` with
  "Installation was interrupted."
- `lastError` only ever contains messages written by EasyHost, never raw
  Docker or database text.
- `GET /api/ports/suggest?preferred=<port>` returns the first port at or above
  `preferred` that no EasyHost app uses and that is free on the host
  (checked by briefly binding it).

## Interface

### First run and login

1. **Create password** — "Welcome to EasyHost", password + confirm, strength
   hint.
2. **Recovery code** — the code, Copy and Download buttons, and a prominent
   note that saving it is strongly recommended because it is the only way
   to recover a forgotten password. Continue is always enabled.
3. Straight to Home.

The login screen has only a password field and a "Forgot password?" link
leading to recovery code + new password, then the new recovery code.

### Layout

A left sidebar with **Home**, **Add** and **Settings**; on phones the same
three items become a bottom bar. Light/dark theme follows the system.

- **Home** — a grid of installed apps. Each card: icon, name, status in plain
  words (Running, Stopped, Installing…, Problem), address with Open and Copy.
  Clicking a card opens the app page. With no apps, Home shows "You don't have
  any apps yet" with four catalog suggestions and an Install button. Home
  refreshes every 5 seconds while visible.
- **App page** — status, address with Open/Copy, Start/Stop, recent logs with
  Refresh and an auto-refresh toggle, the data folder location, and Remove.
  Remove explains that data is kept, with an unchecked "Delete data too" box.
  An app in Problem shows its `lastError` and the actions available.
- **Add** — search and category filters over the catalog. Install opens a
  dialog with the name prefilled and one button; port and settings sit in a
  collapsed Advanced section with the suggested free port preselected. At the
  bottom, "Install a custom image" opens the Advanced form.
- **Settings** — change password, generate a new recovery code, log out,
  EasyHost version.

The address shown for an app uses the hostname the browser used to open
EasyHost: if EasyHost was opened at `http://192.168.1.50:3000`, Jellyfin on
port 8096 is shown as `http://192.168.1.50:8096`.

### Copy

Plain English. "Container", "image" and "port" appear only in Advanced
sections.

## Error handling

New error codes, in addition to Step 1's:

| Code | Status | When |
|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid session |
| `INVALID_CREDENTIALS` | 401 | Wrong password |
| `INVALID_RECOVERY_CODE` | 401 | Wrong or already-used recovery code |
| `TOO_MANY_ATTEMPTS` | 429 | Rate limit hit; body includes `retryAfterSeconds` |
| `SETUP_ALREADY_DONE` | 409 | Setup called when an account exists |
| `CATALOG_APP_NOT_FOUND` | 404 | Unknown `catalogId` |
| `PORT_IN_USE` | 409 | Port taken by another program on the server |

A weak password is a `VALIDATION_FAILED`.

In the interface:

- One table maps every error code to a plain-English message and a suggested
  action. A test fails if a backend code has no entry.
- Any 401 redirects to login and returns to the same page afterwards.
- `TOO_MANY_ATTEMPTS` shows a countdown on the button.
- If the server is unreachable, a banner says "Can't reach EasyHost. Check that
  the server is on." and retries automatically.
- If `/health` reports Docker down, a persistent banner says "Docker isn't
  running on the server, so apps can't start."
- Stack traces, container ids and raw technical text are never shown.

## Testing

Backend (Jest; no Docker daemon, no external network):

- **Auth**: setup only once; login right/wrong; session expiry and extension;
  logout; password change ends other sessions.
- **Recovery**: right code → new password works, old password and old code
  do not, new code works; wrong code rejected; used code rejected; two
  concurrent recoveries with one code → exactly one succeeds.
- **Rate limiting**: delays and remaining seconds with fake timers; reset on
  success; login and recovery counted separately.
- **Route protection**: enumerate every `/api` route and assert it requires a
  session, except the listed public ones.
- **Background install**: `202`, then `RUNNING`, or `ERROR` with `lastError`;
  stale `PENDING` rows become `ERROR` on startup.
- **Catalog**: every entry passes the schema, its icon exists, its image tag
  is pinned.
- **App data**: folders under `DATA_DIR/apps/<id>`; data kept by default and
  deleted only on request; path guard refuses anything outside
  `DATA_DIR/apps/`.
- **Ports**: suggestion skips ports used by apps and ports bound on the host
  (the test binds a real local port).

Frontend (Vitest + React Testing Library, mocked API):

- First run: create password → recovery code screen → empty Home with
  suggestions.
- Login: wrong password; countdown after too many attempts.
- Forgot password through to the new recovery code.
- Install from catalog: card appears as Installing…, then Running.
- Remove with and without "Delete data too".
- Every backend error code has a message.

CI adds the web typecheck, lint, test and build to the existing Node 20/22
workflow.

Before completion, the app is run and used in a browser: first run,
installing a real app where Docker is available, password recovery, and
the phone layout. If Docker is not available on the test machine, this is
reported rather than claimed.

## Out of scope for this step

Multiple users and roles, HTTPS certificates managed by EasyHost, access from
outside the home network, using existing server folders in apps, multi-port
or multi-container apps, app updates, backups, live log streaming, and
translations. The structure leaves room for each.
