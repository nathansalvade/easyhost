# EasyHost — Backend Design (Step 1)

Date: 2026-09-28
Status: Approved

## Intent

EasyHost is an open source tool for managing Docker containers through a web UI.
This step delivers the entire backend: an HTTP API that deploys and controls
containers, persists the installed "Apps" in SQLite, is covered by tests that
never touch a real Docker daemon, and runs those tests in CI.

The UI is out of scope here. The backend must therefore be usable on its own,
with an API shape a UI can consume without changes.

### Success criteria

- `POST /api/apps` pulls an image, creates a container, starts it, and records the App.
- Start / stop / remove and log reading work against a real daemon, and are
  fully covered by tests that mock the daemon.
- `npm test`, `npm run typecheck` and `npm run lint` pass from a clean clone.
- CI runs the same checks on every push and pull request.

### Decisions taken by the project owner

| Question | Decision |
|---|---|
| ORM | Prisma with SQLite |
| Auth in this step | None. The server binds to `127.0.0.1` |
| Log delivery | One-shot tail, no streaming |
| App creation | Full deploy: pull, create, start |

## Architecture

Three layers, dependencies injected through constructors, so each layer is
testable in isolation and the Docker daemon appears in exactly one file.

    src/
      config.ts              env parsing, defaults, validation
      index.ts               bootstrap only
      errors.ts              AppError hierarchy
      docker/
        docker.service.ts    the only module that talks to dockerode
      db/
        client.ts            PrismaClient singleton
      apps/
        app.service.ts       orchestration over DockerService + Prisma
      http/
        server.ts            createServer(deps) -> express.Application
        apps.router.ts       routes and Zod validation
        error.middleware.ts  maps AppError to status codes
        async-handler.ts     forwards rejected promises to the error middleware

`index.ts` only reads config, builds the dependencies, and listens. Tests mount
the app through `createServer` without binding a port.

### DockerService

Receives a `Dockerode` instance in its constructor. Public surface:

- `pullImage(image)` — resolves when the pull completes; wraps
  `modem.followProgress` in a promise and rejects on daemon errors.
- `createAndStart({ name, image, hostPort, containerPort, env })` — returns the container id.
- `start(containerId)` / `stop(containerId)` — idempotent: a container already in
  the target state resolves successfully rather than throwing.
- `remove(containerId, { force })` — a container that no longer exists resolves successfully.
- `logs(containerId, { tail })` — returns the last N lines as a string,
  demultiplexing Docker's stdout/stderr stream framing.
- `inspectState(containerId)` — returns the live state used to reconcile status.

Daemon connection errors (`ENOENT`, `EACCES`, `ECONNREFUSED` on the socket) are
translated into `DockerUnavailableError`.

### AppService

Owns every invariant that spans the database and the daemon:

- `name` and `hostPort` are unique; a collision is a 409 before any daemon call.
- Deploy order: create the row as `PENDING`, pull, create, start, then store
  `containerId` and set `RUNNING`.
- A failure at any point sets `status = ERROR` and keeps the row, with the
  `containerId` recorded if the container was created. Nothing is silently dropped.
- `remove` removes the container (force) and then the row. A container that is
  already gone still removes the row.
- List and get reconcile the stored status against `inspectState`, so a container
  stopped outside EasyHost is not reported as running.

## Data model

    model App {
      id            String   @id @default(cuid())
      name          String   @unique
      image         String
      hostPort      Int      @unique
      containerPort Int
      containerId   String?  @unique
      status        String   // PENDING | RUNNING | STOPPED | ERROR
      createdAt     DateTime @default(now())
      updatedAt     DateTime @updatedAt
    }

`status` is a string because SQLite has no native enum; the allowed values are
defined once as a TypeScript union and validated at the service boundary.
The migration is committed to the repository.

## API

| Method | Path | Behaviour |
|---|---|---|
| GET | `/health` | liveness, plus whether the daemon is reachable |
| GET | `/api/apps` | list, with reconciled status |
| GET | `/api/apps/:id` | single App |
| POST | `/api/apps` | `{ name, image, hostPort, containerPort?, env? }` -> deploy |
| POST | `/api/apps/:id/start` | start the container |
| POST | `/api/apps/:id/stop` | stop the container |
| DELETE | `/api/apps/:id` | remove the container and the record |
| GET | `/api/apps/:id/logs?tail=200` | last N lines, `text/plain` |

`containerPort` defaults to `hostPort` when omitted. `tail` is clamped to a
sane maximum. Request bodies are validated with Zod at the router.

## Error handling

`AppError` subclasses carry an HTTP status and a stable `code`:

| Error | Status | Code |
|---|---|---|
| `ValidationError` | 400 | `VALIDATION_FAILED` |
| `NotFoundError` | 404 | `APP_NOT_FOUND` |
| `ConflictError` | 409 | `NAME_TAKEN` / `PORT_TAKEN` |
| `DockerUnavailableError` | 503 | `DOCKER_UNAVAILABLE` |
| `DockerOperationError` | 502 | `DOCKER_OPERATION_FAILED` |

The error middleware is the only place that formats an error response:
`{ error: { code, message } }`. Raw dockerode errors never reach a client;
they are logged server-side. Any unrecognised error becomes a 500 with a
generic message.

## Testing

Test-driven: each unit's tests are written before its implementation.

- **DockerService** — `Dockerode` fully mocked. Covers a successful pull, a pull
  that fails mid-stream, idempotent start/stop, removing a container that is
  already gone, log demultiplexing and tail clamping, and socket errors mapping
  to `DockerUnavailableError`.
- **AppService** — a real temporary SQLite database per test file with a mocked
  DockerService. Covers the happy-path deploy, name and port conflicts, the
  status left behind when a pull or start fails, status reconciliation, and
  removal when the container has disappeared.
- **HTTP routes** — supertest against `createServer` with a mocked AppService.
  Covers status codes, the error response shape, and Zod rejections.

No test requires a Docker daemon or network access, so CI needs no services.

## CI

`.github/workflows/ci.yml`, on push and pull request:
`npm ci` -> `prisma generate` -> `tsc --noEmit` -> `eslint` -> `jest --coverage`,
on a Node 20 and 22 matrix.

## Out of scope for this step

Authentication, the web UI, container resource limits, volumes, networks,
multi-host support, and log streaming. The layering leaves room for each of
them without restructuring.
