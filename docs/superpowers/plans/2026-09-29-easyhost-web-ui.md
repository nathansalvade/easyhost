# EasyHost Web UI (Step 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give EasyHost a password-protected web interface, reachable from the home network, that installs catalog apps with persistent data and per-OS guides, without the user ever touching a terminal.

**Architecture:** The existing Express backend gains four focused modules (`auth`, `catalog`, `system`, `ports`) plus an install planner, background installs and per-app data folders. A React + Vite SPA in `web/` is built to static files and served by the same Express server on the same port. All `/api` routes except the auth bootstrap routes require a session cookie.

**Tech Stack:** Node 20/22, TypeScript, Express 4, Prisma 5 + SQLite, dockerode, Zod 3, Jest (backend); React 18, react-router-dom 6, Vite 5, Vitest 2, React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-29-easyhost-web-ui-design.md` (read it first; this plan implements it). Step 1 spec: `docs/superpowers/specs/2026-09-28-easyhost-backend-design.md`.

## Global Constraints

- Node 20 and 22 must both pass CI.
- No test may need a Docker daemon or external network. Binding real local ports in tests is allowed.
- No native npm dependencies (password hashing uses Node's built-in `crypto.scrypt`).
- The UI makes no requests to external hosts; icons ship in `catalog/icons/`.
- UI copy is English only, plain words; "container", "image" and "port" appear only in Advanced sections.
- Raw Docker/Prisma error text, stack traces and container ids never reach the UI or `lastError`.
- Error responses keep the Step 1 shape `{ error: { code, message } }`, plus optional extra fields listed per code.
- Password minimum length: 10 characters.
- Recovery code: 20 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, displayed as 4 groups of 5 separated by `-`.
- Sessions: cookie `easyhost_session`, `HttpOnly`, `SameSite=Strict`, `Secure` only when `TRUST_PROXY=true`, 30-day lifetime extended on use.
- Rate limit: 5 free failures per IP, then delay 30 s doubling up to 15 min; login and recovery counted separately.
- Catalog image tags must be pinned (contain a digit, never `latest`).
- Defaults: `HOST=0.0.0.0`, `TRUST_PROXY=false`, `DATA_DIR=./data` (resolved to an absolute path), `CONTAINER_BIND_ADDRESS=0.0.0.0`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push unless the owner asks.

## Review Focus

1. **Ports below 1024 on a non-root Linux server (Pi-hole's port 53):** binding to test availability fails with `EACCES` even when the port is free. Expected: treated as "unknown", the install proceeds, and if Docker then reports the port taken, the user sees `PORT_IN_USE` naming port 53. Tests: Task 10 (`EACCES` → `unknown`), Task 11 (Docker "address already in use" → `PortInUseError`).
2. **Session cookie on plain HTTP:** a `Secure` cookie is silently dropped by browsers on `http://`, so login would appear to succeed and then bounce back. Expected: without `TRUST_PROXY` the cookie has no `Secure` flag. Test: Task 6.
3. **Recovery code typed by a human:** lowercase, without dashes, with spaces, or with the dashes in place. Expected: all accepted. Tests: Task 3 and Task 5.
4. **`DATA_DIR` left at `./data` or containing spaces/accents** (e.g. `C:\Users\Raoul Salvadé\...`): Docker needs absolute host paths and `Binds` strings break on `C:`. Expected: `DATA_DIR` resolved to absolute at startup and mounts passed with the `Mounts` API. Tests: Task 1 (absolute) and Task 11 (path with spaces and accents in `Mounts`).
5. **App name typed like a person would ("My Movies"):** Docker container names reject spaces. Expected: the API refuses it with a friendly `VALIDATION_FAILED`, and the UI install dialog pre-fills and suggests a valid name. Tests: Task 14 (API) and Task 20 (UI).

---

## File Structure

Backend (new unless marked):

| File | Responsibility |
|---|---|
| `src/config.ts` (modify) | add `HOST`, `TRUST_PROXY`, `DATA_DIR` |
| `src/errors.ts` (modify) | new error classes, `details`, exported `ERROR_CODES` |
| `src/http/error.middleware.ts` (modify) | include `details`, `Retry-After` |
| `prisma/schema.prisma` (modify) | `App` fields, `Account`, `Session` |
| `src/auth/crypto.ts` | scrypt hashing, recovery codes, session tokens |
| `src/auth/rate-limiter.ts` | per-key failure counting with delays |
| `src/auth/auth.service.ts` | setup, login, sessions, recovery, password changes |
| `src/http/auth.router.ts` | `/api/auth/*` routes |
| `src/http/auth.middleware.ts` | session guard + JSON-only guard for `/api` |
| `src/catalog/catalog.schema.ts` | Zod schema and types for catalog entries |
| `src/catalog/catalog.ts` | load and validate `catalog/*.json` |
| `catalog/*.json`, `catalog/icons/*.svg` | catalog content |
| `src/system/system.ts` | detect server OS and distro, EasyHost version |
| `src/ports/port-checker.ts` | check host port availability, suggest free ports |
| `src/apps/app-data.ts` | per-app data folders and safe deletion |
| `src/apps/install-planner.ts` | turn a catalog or advanced request into an install spec |
| `src/apps/app.service.ts` (modify) | background installs, volumes, secrets, `lastError` |
| `src/apps/app.view.ts` | API response shapes (hide container id, secrets rules) |
| `src/docker/docker.service.ts`, `docker.types.ts` (modify) | mounts, fixed ports, port-in-use mapping |
| `src/http/apps.router.ts`, `server.ts` (modify) | new routes, 202, static SPA |
| `src/http/system.router.ts` | `/api/system`, `/api/catalog`, `/api/ports/suggest` |
| `src/index.ts` (modify) | wiring, `HOST`, interrupted-install recovery |

Frontend (`web/`):

| File | Responsibility |
|---|---|
| `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html` | build, dev proxy, test config |
| `web/src/main.tsx`, `web/src/App.tsx` | entry, routes, auth gate |
| `web/src/api/client.ts` | fetch wrapper, `ApiError`, 401 handling |
| `web/src/api/messages.ts` | error code → plain-English message |
| `web/src/api/types.ts` | response types |
| `web/src/lib/address.ts`, `web/src/lib/device-os.ts`, `web/src/lib/guide.ts`, `web/src/lib/use-polling.ts` | small pure helpers and the polling hook |
| `web/src/pages/*.tsx` | Setup, RecoveryCode, Login, Recover, Home, AppDetail, Add, Settings |
| `web/src/components/*.tsx` | Layout, AppCard, StatusBadge, GuideView, LogViewer, InstallDialog, Banners, CopyButton |
| `web/src/styles.css` | theme tokens, light/dark, layout |
| `web/src/test/*` | test setup and fetch mock helper |

---

## Phase A — Backend

### Task 1: Configuration for network access and app data

**Files:**
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/docker/docker.service.ts:83-91` (stale doc comment only)
- Modify: `.env.example`

**Interfaces:**
- Produces: `Config.host: string`, `Config.trustProxy: boolean`, `Config.dataDir: string` (absolute).

- [ ] **Step 1: Write the failing tests** — append to `src/config.test.ts` inside the existing top-level `describe`:

```ts
  describe('Step 2 settings', () => {
    const base = { DATABASE_URL: 'file:./dev.db', DOCKER_SOCKET_PATH: '/var/run/docker.sock' };

    it('defaults HOST to 0.0.0.0, TRUST_PROXY to false and DATA_DIR to ./data resolved absolute', () => {
      const config = loadConfig({ ...base });
      expect(config.host).toBe('0.0.0.0');
      expect(config.trustProxy).toBe(false);
      expect(path.isAbsolute(config.dataDir)).toBe(true);
      expect(config.dataDir).toBe(path.resolve('./data'));
    });

    it('accepts TRUST_PROXY=true and a custom HOST', () => {
      const config = loadConfig({ ...base, TRUST_PROXY: 'true', HOST: '127.0.0.1' });
      expect(config.trustProxy).toBe(true);
      expect(config.host).toBe('127.0.0.1');
    });

    it('resolves a DATA_DIR containing spaces and accents to an absolute path', () => {
      const config = loadConfig({ ...base, DATA_DIR: './Raoul Salvadé data' });
      expect(config.dataDir).toBe(path.resolve('./Raoul Salvadé data'));
    });

    it('rejects a HOST that is not an IP address', () => {
      expect(() => loadConfig({ ...base, HOST: 'not-an-ip' })).toThrow();
    });

    it('rejects a TRUST_PROXY value other than true/false', () => {
      expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow();
    });
  });
```

Add `import * as path from 'path';` at the top of the file if not present.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/config.test.ts`
Expected: FAIL — `config.host` is `undefined`.

- [ ] **Step 3: Implement** — in `src/config.ts` add to the Zod object:

```ts
    HOST: z.string().ip().default('0.0.0.0'),
    TRUST_PROXY: z.enum(['true', 'false']).default('false'),
    DATA_DIR: z.string().min(1).default('./data'),
```

pass them through in `loadConfig`:

```ts
    HOST: env.HOST,
    TRUST_PROXY: env.TRUST_PROXY,
    DATA_DIR: env.DATA_DIR,
```

extend `Config` and the returned object:

```ts
  host: string;
  trustProxy: boolean;
  dataDir: string;
```

```ts
    host: parsed.HOST,
    trustProxy: parsed.TRUST_PROXY === 'true',
    // Docker bind mounts need absolute host paths.
    dataDir: path.resolve(parsed.DATA_DIR),
```

with `import * as path from 'path';`.

In `src/docker/docker.service.ts`, replace the `bindAddress` doc comment (it still says loopback) with:

```ts
  /**
   * Host address that published container ports are bound to. Defaults to
   * all interfaces so apps open from other home devices at server-IP:port
   * (see `CONTAINER_BIND_ADDRESS` in config.ts).
   */
```

Append to `.env.example`:

```
# Address the EasyHost interface listens on; 127.0.0.1 makes it reachable only from this machine.
HOST=0.0.0.0
# Set to true only when EasyHost runs behind an HTTPS reverse proxy.
TRUST_PROXY=false
# Folder where each app's data is kept.
DATA_DIR=./data
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/config.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts src/docker/docker.service.ts .env.example
git commit -m "feat: add HOST, TRUST_PROXY and DATA_DIR settings"
```

---

### Task 2: Database schema for accounts, sessions and app metadata

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_step2/migration.sql` (generated)
- Create: `src/db/schema.test.ts`

**Interfaces:**
- Produces: Prisma models `Account { id Int @default(1), passwordHash, recoveryCodeHash, createdAt, updatedAt }`, `Session { id String, createdAt, lastUsedAt, expiresAt }`, and `App` fields `catalogId String?`, `volumes String @default("[]")`, `fixedPorts String @default("[]")`, `secrets String @default("{}")`, `lastError String?`.

- [ ] **Step 1: Write the failing test** — `src/db/schema.test.ts`:

```ts
import { createTempDb } from '../../test/helpers/temp-db';
import type { PrismaClient } from '@prisma/client';

describe('Step 2 schema', () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeAll(() => {
    ({ prisma, cleanup } = createTempDb());
  });
  afterAll(async () => cleanup());

  it('stores a single account with id 1 by default', async () => {
    const account = await prisma.account.create({
      data: { passwordHash: 'p', recoveryCodeHash: 'r' },
    });
    expect(account.id).toBe(1);
    await expect(
      prisma.account.create({ data: { passwordHash: 'p2', recoveryCodeHash: 'r2' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores sessions', async () => {
    const expiresAt = new Date(Date.now() + 1000);
    const session = await prisma.session.create({ data: { id: 'hash', expiresAt } });
    expect(session.lastUsedAt).toBeInstanceOf(Date);
  });

  it('gives apps JSON defaults for volumes, fixed ports and secrets', async () => {
    const app = await prisma.app.create({
      data: { name: 'a', image: 'nginx:1.27', hostPort: 8080, containerPort: 80, status: 'PENDING' },
    });
    expect(app.volumes).toBe('[]');
    expect(app.fixedPorts).toBe('[]');
    expect(app.secrets).toBe('{}');
    expect(app.catalogId).toBeNull();
    expect(app.lastError).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/db/schema.test.ts`
Expected: FAIL — TypeScript error, `prisma.account` does not exist.

- [ ] **Step 3: Implement** — edit `prisma/schema.prisma`:

```prisma
model App {
  id            String   @id @default(cuid())
  name          String   @unique
  image         String
  hostPort      Int      @unique
  containerPort Int
  containerId   String?  @unique
  status        String // PENDING | RUNNING | STOPPED | ERROR
  catalogId     String?
  volumes       String   @default("[]") // JSON: { name, containerPath }[]
  fixedPorts    String   @default("[]") // JSON: { containerPort, hostPort, protocol }[]
  secrets       String   @default("{}") // JSON: { [name]: value }
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Account {
  id               Int      @id @default(1)
  passwordHash     String
  recoveryCodeHash String
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

model Session {
  id         String   @id // SHA-256 of the session token
  createdAt  DateTime @default(now())
  lastUsedAt DateTime @default(now())
  expiresAt  DateTime
}
```

Then generate the migration (uses the gitignored local `.env`):

Run: `npx prisma migrate dev --name step2`
Expected: a new folder `prisma/migrations/<timestamp>_step2/` with `migration.sql`, and the client regenerated.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest`
Expected: PASS — all existing suites plus `schema.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/db/schema.test.ts
git commit -m "feat: add account, session and app metadata schema"
```

---

### Task 3: Password hashing, recovery codes and session tokens

**Files:**
- Create: `src/auth/crypto.ts`
- Create: `src/auth/crypto.test.ts`

**Interfaces:**
- Produces:
  - `hashSecret(secret: string): Promise<string>` — format `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`
  - `verifySecret(secret: string, stored: string): Promise<boolean>`
  - `generateRecoveryCode(): string` — `XXXXX-XXXXX-XXXXX-XXXXX`
  - `normalizeRecoveryCode(input: string): string` — uppercase, only alphabet characters kept
  - `generateSessionToken(): string` — 32 random bytes, base64url
  - `hashToken(token: string): string` — SHA-256 hex
  - `RECOVERY_ALPHABET: string`

- [ ] **Step 1: Write the failing tests** — `src/auth/crypto.test.ts`:

```ts
import {
  RECOVERY_ALPHABET,
  generateRecoveryCode,
  generateSessionToken,
  hashSecret,
  hashToken,
  normalizeRecoveryCode,
  verifySecret,
} from './crypto';

describe('hashSecret / verifySecret', () => {
  it('verifies the right secret and rejects a wrong one', async () => {
    const stored = await hashSecret('correct horse battery');
    expect(stored.startsWith('scrypt$')).toBe(true);
    await expect(verifySecret('correct horse battery', stored)).resolves.toBe(true);
    await expect(verifySecret('wrong', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const a = await hashSecret('same');
    const b = await hashSecret('same');
    expect(a).not.toBe(b);
  });

  it('returns false for a malformed stored value instead of throwing', async () => {
    await expect(verifySecret('x', 'not-a-hash')).resolves.toBe(false);
  });
});

describe('recovery codes', () => {
  it('has four groups of five characters from the unambiguous alphabet', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    for (const ch of code.replace(/-/g, '')) {
      expect(RECOVERY_ALPHABET).toContain(ch);
    }
    expect(RECOVERY_ALPHABET).not.toMatch(/[01ILO]/);
  });

  it('is different every time', () => {
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode());
  });

  it.each([
    ['k7qx2-abcde-fghjk-mnpqr', 'K7QX2ABCDEFGHJKMNPQR'],
    ['K7QX2ABCDEFGHJKMNPQR', 'K7QX2ABCDEFGHJKMNPQR'],
    [' k7qx2 abcde fghjk mnpqr ', 'K7QX2ABCDEFGHJKMNPQR'],
  ])('normalizes %p', (input, expected) => {
    expect(normalizeRecoveryCode(input)).toBe(expected);
  });
});

describe('session tokens', () => {
  it('generates 32-byte base64url tokens and hashes them to hex', () => {
    const token = generateSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/auth/crypto.test.ts`
Expected: FAIL — cannot find module `./crypto`.

- [ ] **Step 3: Implement** — `src/auth/crypto.ts`:

```ts
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function scryptAsync(secret: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, KEY_LENGTH, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(secret, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(secret, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateRecoveryCode(): string {
  const chars = Array.from({ length: 20 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((ch) => RECOVERY_ALPHABET.includes(ch))
    .join('');
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

Recovery codes are hashed in their normalized form (no dashes, uppercase), so any human formatting verifies.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/auth/crypto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/crypto.ts src/auth/crypto.test.ts
git commit -m "feat: add scrypt hashing, recovery codes and session tokens"
```

---

### Task 4: Rate limiter for login and recovery attempts

**Files:**
- Create: `src/auth/rate-limiter.ts`
- Create: `src/auth/rate-limiter.test.ts`

**Interfaces:**
- Produces:
  - `class RateLimiter` with `constructor(options?: { freeAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; now?: () => number })`
  - `check(key: string): { allowed: true } | { allowed: false; retryAfterSeconds: number }`
  - `recordFailure(key: string): void`
  - `reset(key: string): void`

- [ ] **Step 1: Write the failing tests** — `src/auth/rate-limiter.test.ts`:

```ts
import { RateLimiter } from './rate-limiter';

function makeLimiter() {
  let now = 1_000_000;
  const limiter = new RateLimiter({ now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
  it('allows the first five failures without delay', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) {
      expect(limiter.check('ip')).toEqual({ allowed: true });
      limiter.recordFailure('ip');
    }
    expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: 30 });
  });

  it('doubles the delay after each further failure and caps it at 15 minutes', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    const expected = [30, 60, 120, 240, 480, 900, 900];
    for (const seconds of expected) {
      expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: seconds });
      advance(seconds * 1000);
      expect(limiter.check('ip')).toEqual({ allowed: true });
      limiter.recordFailure('ip');
    }
  });

  it('reports the remaining seconds, rounded up', () => {
    const { limiter, advance } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    advance(29_500);
    expect(limiter.check('ip')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it('resets after a success', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip');
    limiter.reset('ip');
    expect(limiter.check('ip')).toEqual({ allowed: true });
  });

  it('keeps keys independent', () => {
    const { limiter } = makeLimiter();
    for (let i = 0; i < 5; i++) limiter.recordFailure('a');
    expect(limiter.check('b')).toEqual({ allowed: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/auth/rate-limiter.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** — `src/auth/rate-limiter.ts`:

```ts
interface Entry {
  failures: number;
  lastFailureAt: number;
}

export interface RateLimiterOptions {
  freeAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
}

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class RateLimiter {
  private readonly entries = new Map<string, Entry>();
  private readonly freeAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;

  constructor({ freeAttempts = 5, baseDelayMs = 30_000, maxDelayMs = 900_000, now = Date.now }: RateLimiterOptions = {}) {
    this.freeAttempts = freeAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.now = now;
  }

  check(key: string): RateLimitDecision {
    const entry = this.entries.get(key);
    if (!entry || entry.failures < this.freeAttempts) {
      return { allowed: true };
    }
    const delay = Math.min(this.baseDelayMs * 2 ** (entry.failures - this.freeAttempts), this.maxDelayMs);
    const remaining = entry.lastFailureAt + delay - this.now();
    if (remaining <= 0) {
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  recordFailure(key: string): void {
    const entry = this.entries.get(key);
    this.entries.set(key, { failures: (entry?.failures ?? 0) + 1, lastFailureAt: this.now() });
  }

  reset(key: string): void {
    this.entries.delete(key);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/auth/rate-limiter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/rate-limiter.ts src/auth/rate-limiter.test.ts
git commit -m "feat: add rate limiter for login and recovery attempts"
```

---

### Task 5: Error classes and the auth service

**Files:**
- Modify: `src/errors.ts`
- Modify: `src/http/error.middleware.ts`
- Modify: `src/http/error.middleware.test.ts`
- Create: `src/auth/auth.service.ts`
- Create: `src/auth/auth.service.test.ts`

**Interfaces:**
- Consumes: Task 2 models; Task 3 `hashSecret`, `verifySecret`, `generateRecoveryCode`, `normalizeRecoveryCode`, `generateSessionToken`, `hashToken`.
- Produces in `src/errors.ts`:
  - `ErrorCode` adds `'UNAUTHENTICATED' | 'INVALID_CREDENTIALS' | 'INVALID_RECOVERY_CODE' | 'TOO_MANY_ATTEMPTS' | 'SETUP_ALREADY_DONE' | 'CATALOG_APP_NOT_FOUND' | 'PORT_IN_USE' | 'JSON_REQUIRED'`
  - `export const ERROR_CODES: readonly ErrorCode[]` (every code, used by the web test in Task 16)
  - `AppError.details?: Record<string, unknown>` (serialized into the error body)
  - classes `UnauthenticatedError` (401), `InvalidCredentialsError` (401), `InvalidRecoveryCodeError` (401), `TooManyAttemptsError(retryAfterSeconds)` (429, details `{ retryAfterSeconds }`), `SetupAlreadyDoneError` (409), `CatalogAppNotFoundError(id)` (404), `PortInUseError(port, protocol)` (409, details `{ port, protocol }`), `JsonRequiredError` (415)
- Produces in `src/auth/auth.service.ts`:
  - `interface IAuthService` and `class AuthService implements IAuthService` with `constructor(prisma: PrismaClient, options?: { now?: () => Date })`
  - `status(token?: string): Promise<{ setupRequired: boolean; authenticated: boolean }>`
  - `setup(password: string): Promise<{ recoveryCode: string; sessionToken: string }>`
  - `login(password: string): Promise<{ sessionToken: string }>`
  - `logout(token: string): Promise<void>`
  - `validateSession(token: string | undefined): Promise<boolean>`
  - `recover(recoveryCode: string, newPassword: string): Promise<{ recoveryCode: string; sessionToken: string }>`
  - `changePassword(token: string, currentPassword: string, newPassword: string): Promise<void>`
  - `regenerateRecoveryCode(password: string): Promise<{ recoveryCode: string }>`
  - `SESSION_TTL_MS = 30 days`, `SESSION_REFRESH_MS = 1 hour`, `MIN_PASSWORD_LENGTH = 10`

- [ ] **Step 1: Write the failing error-middleware tests** — append to `src/http/error.middleware.test.ts` (reuse its existing mock `res` helper; if it has none, use the one below):

```ts
import { PortInUseError, TooManyAttemptsError, ERROR_CODES } from '../errors';

function mockRes() {
  const res: Record<string, jest.Mock> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.set = jest.fn().mockReturnValue(res);
  return res;
}

describe('errorMiddleware details', () => {
  it('adds details to the body and a Retry-After header for TOO_MANY_ATTEMPTS', () => {
    const res = mockRes();
    errorMiddleware(new TooManyAttemptsError(42), {} as never, res as never, jest.fn());
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '42');
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'TOO_MANY_ATTEMPTS', message: expect.any(String), retryAfterSeconds: 42 },
    });
  });

  it('adds port and protocol for PORT_IN_USE', () => {
    const res = mockRes();
    errorMiddleware(new PortInUseError(53, 'udp'), {} as never, res as never, jest.fn());
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'PORT_IN_USE', message: expect.any(String), port: 53, protocol: 'udp' },
    });
  });

  it('never serializes containerId', () => {
    const res = mockRes();
    const err = new PortInUseError(80, 'tcp');
    err.containerId = 'secret-id';
    errorMiddleware(err, {} as never, res as never, jest.fn());
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('secret-id');
  });

  it('exports every error code', () => {
    expect(ERROR_CODES).toEqual(expect.arrayContaining(['UNAUTHENTICATED', 'PORT_IN_USE', 'CONTAINER_MISSING', 'JSON_REQUIRED']));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/http/error.middleware.test.ts`
Expected: FAIL — `TooManyAttemptsError` is not exported.

- [ ] **Step 3: Implement errors and middleware** — in `src/errors.ts` replace the `ErrorCode` type with a const list and add the classes:

```ts
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'APP_NOT_FOUND',
  'NAME_TAKEN',
  'PORT_TAKEN',
  'DOCKER_UNAVAILABLE',
  'DOCKER_OPERATION_FAILED',
  'CONTAINER_MISSING',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'INVALID_RECOVERY_CODE',
  'TOO_MANY_ATTEMPTS',
  'SETUP_ALREADY_DONE',
  'CATALOG_APP_NOT_FOUND',
  'PORT_IN_USE',
  'JSON_REQUIRED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
```

Add to `AppError` (after `containerId`):

```ts
  /** Extra, client-safe fields merged into the error body. */
  public details?: Record<string, unknown>;
```

New classes at the end of the file:

```ts
export class UnauthenticatedError extends AppError {
  constructor(message = 'Please log in') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Wrong password') {
    super(message, 401, 'INVALID_CREDENTIALS');
  }
}

export class InvalidRecoveryCodeError extends AppError {
  constructor(message = 'This recovery code is not valid') {
    super(message, 401, 'INVALID_RECOVERY_CODE');
  }
}

export class TooManyAttemptsError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('Too many attempts, try again later', 429, 'TOO_MANY_ATTEMPTS');
    this.details = { retryAfterSeconds };
  }
}

export class SetupAlreadyDoneError extends AppError {
  constructor(message = 'EasyHost is already set up') {
    super(message, 409, 'SETUP_ALREADY_DONE');
  }
}

export class CatalogAppNotFoundError extends AppError {
  constructor(catalogId: string) {
    super(`No catalog app called "${catalogId}"`, 404, 'CATALOG_APP_NOT_FOUND');
  }
}

export class PortInUseError extends AppError {
  constructor(port: number, protocol: 'tcp' | 'udp') {
    super(`Port ${port} is already used by another program on the server`, 409, 'PORT_IN_USE');
    this.details = { port, protocol };
  }
}

export class JsonRequiredError extends AppError {
  constructor() {
    super('Requests must be sent as JSON', 415, 'JSON_REQUIRED');
  }
}
```

In `src/http/error.middleware.ts` replace the `AppError` branch:

```ts
  if (err instanceof AppError) {
    const retryAfter = err.details?.retryAfterSeconds;
    if (typeof retryAfter === 'number') {
      res.set('Retry-After', String(retryAfter));
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    return;
  }
```

Run: `npx jest src/http/error.middleware.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Write the failing auth service tests** — `src/auth/auth.service.test.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { createTempDb } from '../../test/helpers/temp-db';
import { AuthService, SESSION_TTL_MS } from './auth.service';

describe('AuthService', () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;
  let now: Date;
  let auth: AuthService;

  beforeAll(() => {
    ({ prisma, cleanup } = createTempDb());
  });
  afterAll(async () => cleanup());

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    now = new Date('2026-09-29T10:00:00Z');
    auth = new AuthService(prisma, { now: () => now });
  });

  describe('setup', () => {
    it('reports setupRequired until an account exists', async () => {
      await expect(auth.status()).resolves.toEqual({ setupRequired: true, authenticated: false });
      const { sessionToken } = await auth.setup('long enough pw');
      await expect(auth.status(sessionToken)).resolves.toEqual({ setupRequired: false, authenticated: true });
    });

    it('returns a formatted recovery code and a working session', async () => {
      const { recoveryCode, sessionToken } = await auth.setup('long enough pw');
      expect(recoveryCode).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
    });

    it('can only run once', async () => {
      await auth.setup('long enough pw');
      await expect(auth.setup('another long pw')).rejects.toMatchObject({ code: 'SETUP_ALREADY_DONE' });
    });

    it('lets only one of two concurrent setups succeed', async () => {
      const results = await Promise.allSettled([auth.setup('first long pw'), auth.setup('second long pw')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({ code: 'SETUP_ALREADY_DONE' }),
      });
    });

    it('rejects passwords shorter than 10 characters', async () => {
      await expect(auth.setup('short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('login and sessions', () => {
    beforeEach(async () => {
      await auth.setup('long enough pw');
    });

    it('logs in with the right password', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
    });

    it('rejects a wrong password', async () => {
      await expect(auth.login('nope nope nope')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });

    it('rejects missing, unknown and expired sessions', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      await expect(auth.validateSession(undefined)).resolves.toBe(false);
      await expect(auth.validateSession('made-up')).resolves.toBe(false);
      now = new Date(now.getTime() + SESSION_TTL_MS + 1);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(false);
    });

    it('extends a session that is used', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      now = new Date(now.getTime() + SESSION_TTL_MS - 60_000);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
      now = new Date(now.getTime() + 120_000);
      await expect(auth.validateSession(sessionToken)).resolves.toBe(true);
    });

    it('logout ends only that session', async () => {
      const a = await auth.login('long enough pw');
      const b = await auth.login('long enough pw');
      await auth.logout(a.sessionToken);
      await expect(auth.validateSession(a.sessionToken)).resolves.toBe(false);
      await expect(auth.validateSession(b.sessionToken)).resolves.toBe(true);
    });

    it('changing the password ends all other sessions', async () => {
      const current = await auth.login('long enough pw');
      const other = await auth.login('long enough pw');
      await auth.changePassword(current.sessionToken, 'long enough pw', 'brand new password');
      await expect(auth.validateSession(current.sessionToken)).resolves.toBe(true);
      await expect(auth.validateSession(other.sessionToken)).resolves.toBe(false);
      await expect(auth.login('long enough pw')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(auth.login('brand new password')).resolves.toHaveProperty('sessionToken');
    });

    it('refuses a password change with the wrong current password', async () => {
      const { sessionToken } = await auth.login('long enough pw');
      await expect(auth.changePassword(sessionToken, 'wrong wrong', 'brand new password')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });
  });

  describe('recovery', () => {
    let firstCode: string;

    beforeEach(async () => {
      ({ recoveryCode: firstCode } = await auth.setup('original password'));
    });

    it('sets the new password, invalidates the old one and the old code, and returns a new working code', async () => {
      const result = await auth.recover(firstCode, 'recovered password');
      expect(result.recoveryCode).not.toBe(firstCode);
      await expect(auth.validateSession(result.sessionToken)).resolves.toBe(true);
      await expect(auth.login('original password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(auth.login('recovered password')).resolves.toHaveProperty('sessionToken');
      await expect(auth.recover(firstCode, 'another password')).rejects.toMatchObject({ code: 'INVALID_RECOVERY_CODE' });
      await expect(auth.recover(result.recoveryCode, 'third password!')).resolves.toHaveProperty('recoveryCode');
    });

    it('ends every existing session', async () => {
      const { sessionToken } = await auth.login('original password');
      await auth.recover(firstCode, 'recovered password');
      await expect(auth.validateSession(sessionToken)).resolves.toBe(false);
    });

    it('rejects a wrong code with the same error as a used one', async () => {
      await expect(auth.recover('AAAAA-AAAAA-AAAAA-AAAAA', 'recovered password')).rejects.toMatchObject({
        code: 'INVALID_RECOVERY_CODE',
      });
    });

    it('accepts the code typed in lowercase, without dashes, or with spaces', async () => {
      const typed = firstCode.toLowerCase().replace(/-/g, ' ');
      await expect(auth.recover(typed, 'recovered password')).resolves.toHaveProperty('sessionToken');
    });

    it('lets exactly one of two concurrent recoveries with the same code succeed', async () => {
      const results = await Promise.allSettled([
        auth.recover(firstCode, 'first new password'),
        auth.recover(firstCode, 'second new password'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({ code: 'INVALID_RECOVERY_CODE' }),
      });
    });

    it('rejects a new password shorter than 10 characters without consuming the code', async () => {
      await expect(auth.recover(firstCode, 'short')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(auth.recover(firstCode, 'long enough now')).resolves.toHaveProperty('sessionToken');
    });

    it('regenerates the recovery code after confirming the password', async () => {
      const { recoveryCode } = await auth.regenerateRecoveryCode('original password');
      await expect(auth.recover(firstCode, 'recovered password')).rejects.toMatchObject({ code: 'INVALID_RECOVERY_CODE' });
      await expect(auth.recover(recoveryCode, 'recovered password')).resolves.toHaveProperty('sessionToken');
    });

    it('refuses to regenerate with a wrong password', async () => {
      await expect(auth.regenerateRecoveryCode('wrong wrong')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    });
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx jest src/auth/auth.service.test.ts`
Expected: FAIL — cannot find module `./auth.service`.

- [ ] **Step 6: Implement** — `src/auth/auth.service.ts`:

```ts
import { Prisma, PrismaClient } from '@prisma/client';
import {
  InvalidCredentialsError,
  InvalidRecoveryCodeError,
  SetupAlreadyDoneError,
  UnauthenticatedError,
  ValidationError,
} from '../errors';
import {
  generateRecoveryCode,
  generateSessionToken,
  hashSecret,
  hashToken,
  normalizeRecoveryCode,
  verifySecret,
} from './crypto';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_MS = 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 10;
const ACCOUNT_ID = 1;

export interface IAuthService {
  status(token?: string): Promise<{ setupRequired: boolean; authenticated: boolean }>;
  setup(password: string): Promise<{ recoveryCode: string; sessionToken: string }>;
  login(password: string): Promise<{ sessionToken: string }>;
  logout(token: string): Promise<void>;
  validateSession(token: string | undefined): Promise<boolean>;
  recover(recoveryCode: string, newPassword: string): Promise<{ recoveryCode: string; sessionToken: string }>;
  changePassword(token: string, currentPassword: string, newPassword: string): Promise<void>;
  regenerateRecoveryCode(password: string): Promise<{ recoveryCode: string }>;
}

function assertPasswordLength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
}

export class AuthService implements IAuthService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaClient,
    { now = () => new Date() }: { now?: () => Date } = {},
  ) {
    this.now = now;
  }

  async status(token?: string) {
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    return { setupRequired: !account, authenticated: account ? await this.validateSession(token) : false };
  }

  async setup(password: string) {
    assertPasswordLength(password);
    const recoveryCode = generateRecoveryCode();
    const [passwordHash, recoveryCodeHash] = await Promise.all([
      hashSecret(password),
      hashSecret(normalizeRecoveryCode(recoveryCode)),
    ]);
    try {
      await this.prisma.account.create({ data: { id: ACCOUNT_ID, passwordHash, recoveryCodeHash } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new SetupAlreadyDoneError();
      }
      throw err;
    }
    return { recoveryCode, sessionToken: await this.createSession(this.prisma) };
  }

  async login(password: string) {
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    if (!account || !(await verifySecret(password, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    return { sessionToken: await this.createSession(this.prisma) };
  }

  async logout(token: string) {
    await this.prisma.session.deleteMany({ where: { id: hashToken(token) } });
  }

  async validateSession(token: string | undefined) {
    if (!token) return false;
    const id = hashToken(token);
    const session = await this.prisma.session.findUnique({ where: { id } });
    const now = this.now();
    if (!session || session.expiresAt <= now) {
      return false;
    }
    if (now.getTime() - session.lastUsedAt.getTime() >= SESSION_REFRESH_MS) {
      await this.prisma.session.updateMany({
        where: { id },
        data: { lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
      });
    }
    return true;
  }

  async recover(recoveryCode: string, newPassword: string) {
    assertPasswordLength(newPassword);
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    if (!account || !(await verifySecret(normalizeRecoveryCode(recoveryCode), account.recoveryCodeHash))) {
      throw new InvalidRecoveryCodeError();
    }
    const newCode = generateRecoveryCode();
    const [passwordHash, recoveryCodeHash] = await Promise.all([
      hashSecret(newPassword),
      hashSecret(normalizeRecoveryCode(newCode)),
    ]);
    // Compare-and-swap on the verified code hash: a concurrent recovery that
    // already consumed this code changed the hash, so this update matches 0 rows.
    const sessionToken = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.account.updateMany({
        where: { id: ACCOUNT_ID, recoveryCodeHash: account.recoveryCodeHash },
        data: { passwordHash, recoveryCodeHash },
      });
      if (count !== 1) {
        throw new InvalidRecoveryCodeError();
      }
      await tx.session.deleteMany();
      return this.createSession(tx);
    });
    return { recoveryCode: newCode, sessionToken };
  }

  async changePassword(token: string, currentPassword: string, newPassword: string) {
    if (!(await this.validateSession(token))) {
      throw new UnauthenticatedError();
    }
    assertPasswordLength(newPassword);
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id: ACCOUNT_ID } });
    if (!(await verifySecret(currentPassword, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    const passwordHash = await hashSecret(newPassword);
    await this.prisma.$transaction([
      this.prisma.account.update({ where: { id: ACCOUNT_ID }, data: { passwordHash } }),
      this.prisma.session.deleteMany({ where: { id: { not: hashToken(token) } } }),
    ]);
  }

  async regenerateRecoveryCode(password: string) {
    const account = await this.prisma.account.findUnique({ where: { id: ACCOUNT_ID } });
    if (!account || !(await verifySecret(password, account.passwordHash))) {
      throw new InvalidCredentialsError();
    }
    const recoveryCode = generateRecoveryCode();
    await this.prisma.account.update({
      where: { id: ACCOUNT_ID },
      data: { recoveryCodeHash: await hashSecret(normalizeRecoveryCode(recoveryCode)) },
    });
    return { recoveryCode };
  }

  private async createSession(db: Pick<PrismaClient, 'session'> | Prisma.TransactionClient): Promise<string> {
    const token = generateSessionToken();
    const now = this.now();
    await db.session.create({
      data: { id: hashToken(token), createdAt: now, lastUsedAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL_MS) },
    });
    return token;
  }
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npx jest src/auth && npm run typecheck`
Expected: PASS. If the concurrent-setup test is flaky on SQLite `SQLITE_BUSY`, the loser must still surface as `SETUP_ALREADY_DONE`: map Prisma `P2034` (transaction conflict) the same way as `P2002` in `setup`, and to `InvalidRecoveryCodeError` in `recover`, then rerun 5 times with `npx jest src/auth/auth.service.test.ts --runInBand` repeated to confirm stability.

- [ ] **Step 8: Commit**

```bash
git add src/errors.ts src/http/error.middleware.ts src/http/error.middleware.test.ts src/auth/auth.service.ts src/auth/auth.service.test.ts
git commit -m "feat: add auth service with sessions and recovery codes"
```

---

### Task 6: Auth routes, session guard and server wiring

**Files:**
- Create: `src/http/auth.router.ts`
- Create: `src/http/auth.middleware.ts`
- Create: `src/http/auth.router.test.ts`
- Modify: `src/http/server.ts`
- Modify: `src/http/server.test.ts` (existing tests must now send a session)
- Modify: `package.json` (add `cookie-parser`, `@types/cookie-parser`)

**Interfaces:**
- Consumes: Task 4 `RateLimiter`; Task 5 `IAuthService`, error classes.
- Produces:
  - `SESSION_COOKIE = 'easyhost_session'`
  - `createAuthRouter(deps: { auth: IAuthService; loginLimiter: RateLimiter; recoveryLimiter: RateLimiter; secureCookies: boolean }): Router`
  - `requireJson: RequestHandler` — POST/PUT/PATCH under `/api` must be `application/json`
  - `requireSession(auth: IAuthService, cookieOptions: CookieOptions): RequestHandler` — public: `GET /api/auth/status`, `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/recover`; re-issues the cookie on every authenticated request
  - `sessionCookieOptions(secure: boolean): CookieOptions`
  - `ServerDeps` gains `authService: IAuthService`, `secureCookies?: boolean`, `trustProxy?: boolean`, `loginLimiter?: RateLimiter`, `recoveryLimiter?: RateLimiter`
  - test helper `test/helpers/auth.ts`: `makeAuthServiceMock(authenticated = true): jest.Mocked<IAuthService>` and `AUTH_COOKIE = 'easyhost_session=test-token'`

- [ ] **Step 1: Install dependencies**

Run: `npm install cookie-parser && npm install -D @types/cookie-parser`
Expected: both added to `package.json`.

- [ ] **Step 2: Create the shared test helper** — `test/helpers/auth.ts`:

```ts
import type { IAuthService } from '../../src/auth/auth.service';

export const AUTH_COOKIE = 'easyhost_session=test-token';

export function makeAuthServiceMock(authenticated = true): jest.Mocked<IAuthService> {
  return {
    status: jest.fn().mockResolvedValue({ setupRequired: false, authenticated }),
    setup: jest.fn(),
    login: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    validateSession: jest.fn(async (token?: string) => authenticated && token === 'test-token'),
    recover: jest.fn(),
    changePassword: jest.fn().mockResolvedValue(undefined),
    regenerateRecoveryCode: jest.fn(),
  };
}
```

- [ ] **Step 3: Write the failing route tests** — `src/http/auth.router.test.ts`:

```ts
import request from 'supertest';
import { createServer } from './server';
import { RateLimiter } from '../auth/rate-limiter';
import { InvalidCredentialsError } from '../errors';
import { AUTH_COOKIE, makeAuthServiceMock } from '../../test/helpers/auth';
import type { IAppService } from '../apps/app.service';
import type { IDockerService } from '../docker/docker.service';

function build(options: { authenticated?: boolean; secureCookies?: boolean } = {}) {
  const authService = makeAuthServiceMock(options.authenticated ?? true);
  const appService = { list: jest.fn().mockResolvedValue([]) } as unknown as IAppService;
  const dockerService = { ping: jest.fn().mockResolvedValue(true) } as unknown as IDockerService;
  const loginLimiter = new RateLimiter();
  const recoveryLimiter = new RateLimiter();
  const app = createServer({
    appService,
    dockerService,
    authService,
    loginLimiter,
    recoveryLimiter,
    secureCookies: options.secureCookies ?? false,
  });
  return { app, authService, loginLimiter };
}

describe('auth routes', () => {
  it('GET /api/auth/status is public', async () => {
    const { app } = build({ authenticated: false });
    const res = await request(app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ setupRequired: false, authenticated: false });
  });

  it('POST /api/auth/setup sets an HttpOnly SameSite=Strict cookie without Secure on plain HTTP', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.setup.mockResolvedValue({ recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD', sessionToken: 'tok' });
    const res = await request(app).post('/api/auth/setup').send({ password: 'long enough pw' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD' });
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^easyhost_session=tok;/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Secure/);
  });

  it('marks the cookie Secure when secureCookies is on', async () => {
    const { app, authService } = build({ authenticated: false, secureCookies: true });
    authService.login.mockResolvedValue({ sessionToken: 'tok' });
    const res = await request(app).post('/api/auth/login').send({ password: 'long enough pw' });
    expect(res.headers['set-cookie'][0]).toMatch(/Secure/);
  });

  it('rate-limits failed logins and answers 429 with retryAfterSeconds', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.login.mockRejectedValue(new InvalidCredentialsError());
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send({ password: 'wrong wrong' });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ password: 'wrong wrong' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: 30 });
    expect(blocked.headers['retry-after']).toBe('30');
    expect(authService.login).toHaveBeenCalledTimes(5);
  });

  it('counts recovery attempts separately from logins', async () => {
    const { app, authService } = build({ authenticated: false });
    authService.login.mockRejectedValue(new InvalidCredentialsError());
    authService.recover.mockResolvedValue({ recoveryCode: 'NEW', sessionToken: 'tok' });
    for (let i = 0; i < 6; i++) {
      await request(app).post('/api/auth/login').send({ password: 'wrong wrong' });
    }
    const res = await request(app).post('/api/auth/recover').send({ recoveryCode: 'x', newPassword: 'long enough pw' });
    expect(res.status).toBe(200);
  });

  it('POST /api/auth/logout clears the cookie', async () => {
    const { app, authService } = build();
    const res = await request(app).post('/api/auth/logout').set('Cookie', AUTH_COOKIE).send({});
    expect(res.status).toBe(204);
    expect(authService.logout).toHaveBeenCalledWith('test-token');
    expect(res.headers['set-cookie'][0]).toMatch(/easyhost_session=;/);
  });

  it('POST /api/auth/password passes the current session token', async () => {
    const { app, authService } = build();
    const res = await request(app)
      .post('/api/auth/password')
      .set('Cookie', AUTH_COOKIE)
      .send({ currentPassword: 'old password!', newPassword: 'new password!!' });
    expect(res.status).toBe(204);
    expect(authService.changePassword).toHaveBeenCalledWith('test-token', 'old password!', 'new password!!');
  });

  it('rejects a body with missing fields as VALIDATION_FAILED', async () => {
    const { app } = build({ authenticated: false });
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('route protection', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['get', '/api/apps'],
    ['get', '/api/apps/some-id'],
    ['post', '/api/apps'],
    ['post', '/api/apps/some-id/start'],
    ['post', '/api/apps/some-id/stop'],
    ['delete', '/api/apps/some-id'],
    ['get', '/api/apps/some-id/logs'],
    ['post', '/api/auth/logout'],
    ['post', '/api/auth/password'],
    ['post', '/api/auth/recovery-code'],
    ['get', '/api/catalog'],
    ['get', '/api/system'],
    ['get', '/api/ports/suggest'],
    ['get', '/api/a-route-added-in-the-future'],
  ];

  it.each(protectedRoutes)('%s %s requires a session', async (method, path) => {
    const { app } = build({ authenticated: false });
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method](path)
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('re-issues the session cookie on authenticated requests so an active session never expires in the browser', async () => {
    const { app } = build();
    const res = await request(app).get('/api/apps').set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/^easyhost_session=test-token;.*Max-Age=2592000/);
  });

  it('keeps /health public', async () => {
    const { app } = build({ authenticated: false });
    expect((await request(app).get('/health')).status).toBe(200);
  });

  it('rejects a non-JSON POST with 415 JSON_REQUIRED', async () => {
    const { app } = build();
    const res = await request(app)
      .post('/api/apps/some-id/start')
      .set('Cookie', AUTH_COOKIE)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=b');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('JSON_REQUIRED');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest src/http/auth.router.test.ts`
Expected: FAIL — `authService` is not part of `ServerDeps`.

- [ ] **Step 5: Implement the middleware** — `src/http/auth.middleware.ts`:

```ts
import type { CookieOptions, RequestHandler } from 'express';
import { SESSION_TTL_MS, type IAuthService } from '../auth/auth.service';
import { JsonRequiredError, UnauthenticatedError } from '../errors';

export const SESSION_COOKIE = 'easyhost_session';

const PUBLIC_ROUTES = new Set([
  'GET /api/auth/status',
  'POST /api/auth/setup',
  'POST /api/auth/login',
  'POST /api/auth/recover',
]);

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export const requireJson: RequestHandler = (req, _res, next) => {
  if (BODY_METHODS.has(req.method) && !req.is('application/json')) {
    next(new JsonRequiredError());
    return;
  }
  next();
};

/**
 * The server extends a session on use; the cookie is re-issued on every
 * authenticated request so the browser's copy is extended too (otherwise it
 * would expire 30 days after login even for someone using EasyHost daily).
 */
export function requireSession(auth: IAuthService, cookieOptions: CookieOptions): RequestHandler {
  return (req, res, next) => {
    if (PUBLIC_ROUTES.has(`${req.method} ${req.baseUrl}${req.path}`)) {
      next();
      return;
    }
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];
    auth
      .validateSession(token)
      .then((ok) => {
        if (!ok) return next(new UnauthenticatedError());
        res.cookie(SESSION_COOKIE, token!, cookieOptions);
        next();
      })
      .catch(next);
  };
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: SESSION_TTL_MS };
}
```

- [ ] **Step 6: Implement the router** — `src/http/auth.router.ts`:

```ts
import { Router, type CookieOptions, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { SESSION_COOKIE, sessionCookieOptions } from './auth.middleware';
import type { IAuthService } from '../auth/auth.service';
import type { RateLimiter } from '../auth/rate-limiter';
import { AppError, TooManyAttemptsError, ValidationError } from '../errors';

export interface AuthRouterDeps {
  auth: IAuthService;
  loginLimiter: RateLimiter;
  recoveryLimiter: RateLimiter;
  secureCookies: boolean;
}

const passwordBody = z.object({ password: z.string().min(1) });
const recoverBody = z.object({ recoveryCode: z.string().min(1), newPassword: z.string().min(1) });
const changeBody = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(1) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}

async function limited<T>(limiter: RateLimiter, req: Request, attempt: () => Promise<T>): Promise<T> {
  const key = req.ip ?? 'unknown';
  const decision = limiter.check(key);
  if (!decision.allowed) {
    throw new TooManyAttemptsError(decision.retryAfterSeconds);
  }
  try {
    const result = await attempt();
    limiter.reset(key);
    return result;
  } catch (err) {
    if (err instanceof AppError && (err.code === 'INVALID_CREDENTIALS' || err.code === 'INVALID_RECOVERY_CODE')) {
      limiter.recordFailure(key);
    }
    throw err;
  }
}

export function createAuthRouter({ auth, loginLimiter, recoveryLimiter, secureCookies }: AuthRouterDeps): Router {
  const router = Router();
  const cookieOptions: CookieOptions = sessionCookieOptions(secureCookies);
  const setSession = (res: Response, token: string) => res.cookie(SESSION_COOKIE, token, cookieOptions);
  const tokenOf = (req: Request): string => req.cookies[SESSION_COOKIE];

  router.get('/status', asyncHandler(async (req, res) => {
    res.json(await auth.status(req.cookies?.[SESSION_COOKIE]));
  }));

  router.post('/setup', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    const { recoveryCode, sessionToken } = await auth.setup(password);
    setSession(res, sessionToken);
    res.status(201).json({ recoveryCode });
  }));

  router.post('/login', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    const { sessionToken } = await limited(loginLimiter, req, () => auth.login(password));
    setSession(res, sessionToken);
    res.status(204).send();
  }));

  router.post('/recover', asyncHandler(async (req, res) => {
    const { recoveryCode, newPassword } = parse(recoverBody, req.body);
    const result = await limited(recoveryLimiter, req, () => auth.recover(recoveryCode, newPassword));
    setSession(res, result.sessionToken);
    res.json({ recoveryCode: result.recoveryCode });
  }));

  router.post('/logout', asyncHandler(async (req, res) => {
    await auth.logout(tokenOf(req));
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
    res.status(204).send();
  }));

  router.post('/password', asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(changeBody, req.body);
    await limited(loginLimiter, req, () => auth.changePassword(tokenOf(req), currentPassword, newPassword));
    res.status(204).send();
  }));

  router.post('/recovery-code', asyncHandler(async (req, res) => {
    const { password } = parse(passwordBody, req.body);
    res.json(await limited(loginLimiter, req, () => auth.regenerateRecoveryCode(password)));
  }));

  return router;
}
```

- [ ] **Step 7: Wire the server** — replace `src/http/server.ts`:

```ts
import express, { Application } from 'express';
import cookieParser from 'cookie-parser';
import { asyncHandler } from './async-handler';
import { createAppsRouter } from './apps.router';
import { createAuthRouter } from './auth.router';
import { requireJson, requireSession, sessionCookieOptions } from './auth.middleware';
import { errorMiddleware } from './error.middleware';
import { RateLimiter } from '../auth/rate-limiter';
import type { IAppService } from '../apps/app.service';
import type { IAuthService } from '../auth/auth.service';
import type { IDockerService } from '../docker/docker.service';

export interface ServerDeps {
  appService: IAppService;
  dockerService: IDockerService;
  authService: IAuthService;
  secureCookies?: boolean;
  trustProxy?: boolean;
  loginLimiter?: RateLimiter;
  recoveryLimiter?: RateLimiter;
}

export function createServer(deps: ServerDeps): Application {
  const app = express();
  if (deps.trustProxy) {
    app.set('trust proxy', true);
  }
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', asyncHandler(async (_req, res) => {
    res.json({ ok: true, docker: await deps.dockerService.ping() });
  }));

  app.use('/api', requireJson);
  app.use('/api', requireSession(deps.authService, sessionCookieOptions(deps.secureCookies ?? false)));
  app.use('/api/auth', createAuthRouter({
    auth: deps.authService,
    loginLimiter: deps.loginLimiter ?? new RateLimiter(),
    recoveryLimiter: deps.recoveryLimiter ?? new RateLimiter(),
    secureCookies: deps.secureCookies ?? false,
  }));
  app.use('/api/apps', createAppsRouter(deps.appService));

  app.use(errorMiddleware);
  return app;
}
```

Note: `requireSession` sees `req.baseUrl === '/api'` and `req.path === '/auth/status'` when mounted with `app.use('/api', ...)`, which is why `PUBLIC_ROUTES` keys are built from `baseUrl + path`.

- [ ] **Step 8: Update existing server tests** — in `src/http/server.test.ts`:
  - import `{ AUTH_COOKIE, makeAuthServiceMock } from '../../test/helpers/auth'`;
  - pass `authService: makeAuthServiceMock()` in every `createServer({...})` call;
  - add `.set('Cookie', AUTH_COOKIE)` to every `/api` request;
  - for POST requests without a body (start/stop), add `.send({})` so `Content-Type: application/json` is set.

- [ ] **Step 9: Update `src/index.ts`** — construct the auth service and bind to `HOST`:

```ts
import { AuthService } from './auth/auth.service';
```

```ts
  const authService = new AuthService(prisma);
  const app = createServer({
    appService,
    dockerService,
    authService,
    secureCookies: config.trustProxy,
    trustProxy: config.trustProxy,
  });

  app.listen(config.port, config.host, () => {
    console.log(`EasyHost is running at http://${config.host === '0.0.0.0' ? '<server-IP>' : config.host}:${config.port}`);
  });
```

Delete the old "only ever binds to localhost" comment.

- [ ] **Step 10: Run to verify pass**

Run: `npx jest && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json src/http test/helpers/auth.ts src/index.ts
git commit -m "feat: protect the API with sessions and add auth routes"
```

---

### Task 7: Catalog schema and loader

**Files:**
- Create: `src/catalog/catalog.schema.ts`
- Create: `src/catalog/catalog.ts`
- Create: `src/catalog/catalog.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORIES = ['Media', 'Files', 'Smart home', 'Network', 'Monitoring'] as const`
  - types `GuideStep = { text: string; command?: string }`, `Volume = { name: string; containerPath: string }`, `FixedPort = { containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }`, `GeneratedSecret = { name: string; label: string; env: string }`, `Guide`, `CatalogEntry`
  - `isPinnedImage(image: string): boolean`
  - `loadCatalog(dir: string): Catalog` (throws `Error` naming the file on any problem)
  - `class Catalog { readonly entries: CatalogEntry[]; get(id: string): CatalogEntry | undefined }`
  - Guide text may contain `{serverAddress}`; the UI replaces it with the host the browser used.

- [ ] **Step 1: Write the failing tests** — `src/catalog/catalog.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isPinnedImage, loadCatalog } from './catalog';

function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'demo',
    name: 'Demo',
    description: 'A demo app.',
    category: 'Media',
    icon: 'icons/demo.svg',
    image: 'demo/demo:1.2.3',
    containerPort: 80,
    defaultHostPort: 8080,
    guide: { afterInstall: [{ text: 'Open it.' }] },
    ...overrides,
  };
}

function writeCatalog(entries: Array<Record<string, unknown>>, icons: string[] = ['demo']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost-catalog-'));
  fs.mkdirSync(path.join(dir, 'icons'));
  for (const icon of icons) fs.writeFileSync(path.join(dir, 'icons', `${icon}.svg`), '<svg/>');
  for (const entry of entries) fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(entry));
  return dir;
}

describe('isPinnedImage', () => {
  it.each([
    ['nginx:1.27.2', true],
    ['ghcr.io/home-assistant/home-assistant:2025.3.4', true],
    ['localhost:5000/app:v2', true],
    ['nginx', false],
    ['nginx:latest', false],
    ['nginx:stable', false],
    ['localhost:5000/app', false],
  ])('%s → %s', (image, expected) => {
    expect(isPinnedImage(image)).toBe(expected);
  });
});

describe('loadCatalog', () => {
  it('loads valid entries with defaults for optional fields', () => {
    const catalog = loadCatalog(writeCatalog([validEntry()]));
    const entry = catalog.get('demo');
    expect(entry).toMatchObject({ id: 'demo', env: {}, volumes: [], fixedPorts: [], generatedSecrets: [] });
    expect(catalog.entries).toHaveLength(1);
  });

  it('accepts per-OS guides with distro variants', () => {
    const guide = {
      afterInstall: [{ text: 'Open it.' }],
      server: { linux: { default: [{ text: 'Nothing to do.' }], ubuntu: [{ text: 'Run:', command: 'sudo true' }] } },
      devices: { router: [{ text: 'Set DNS to {serverAddress}.' }], ios: [{ text: 'Settings.' }] },
    };
    expect(() => loadCatalog(writeCatalog([validEntry({ guide })]))).not.toThrow();
  });

  it.each([
    ['an unpinned image', { image: 'demo/demo:latest' }],
    ['a missing description', { description: undefined }],
    ['an empty afterInstall guide', { guide: { afterInstall: [] } }],
    ['an unknown category', { category: 'Games' }],
    ['a bad volume name', { volumes: [{ name: '../x', containerPath: '/data' }] }],
    ['an unknown field', { surprise: true }],
  ])('rejects %s, naming the file', (_label, overrides) => {
    const dir = writeCatalog([validEntry(overrides)]);
    expect(() => loadCatalog(dir)).toThrow(/demo\.json/);
  });

  it('rejects an entry whose icon file is missing', () => {
    expect(() => loadCatalog(writeCatalog([validEntry()], []))).toThrow(/icon/);
  });

  it('rejects a file name that does not match the id', () => {
    const dir = writeCatalog([validEntry()]);
    fs.renameSync(path.join(dir, 'demo.json'), path.join(dir, 'other.json'));
    expect(() => loadCatalog(dir)).toThrow(/other\.json/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/catalog`
Expected: FAIL — cannot find module `./catalog`.

- [ ] **Step 3: Implement the schema** — `src/catalog/catalog.schema.ts`:

```ts
import { z } from 'zod';

export const CATEGORIES = ['Media', 'Files', 'Smart home', 'Network', 'Monitoring'] as const;

export function isPinnedImage(image: string): boolean {
  const lastSlash = image.lastIndexOf('/');
  const lastColon = image.lastIndexOf(':');
  if (lastColon <= lastSlash) return false;
  const tag = image.slice(lastColon + 1);
  return tag !== 'latest' && /\d/.test(tag);
}

const port = z.number().int().min(1).max(65535);
const envKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const step = z.object({ text: z.string().min(1), command: z.string().min(1).optional() }).strict();
const steps = z.array(step).min(1);

export const volumeSchema = z
  .object({ name: z.string().regex(/^[a-z0-9-]+$/), containerPath: z.string().startsWith('/') })
  .strict();
export const fixedPortSchema = z
  .object({ containerPort: port, hostPort: port, protocol: z.enum(['tcp', 'udp']) })
  .strict();

const guideSchema = z
  .object({
    afterInstall: steps,
    server: z
      .object({
        linux: z.object({ default: steps }).catchall(steps).optional(),
        windows: steps.optional(),
        macos: steps.optional(),
      })
      .strict()
      .optional(),
    devices: z
      .object({
        router: steps.optional(),
        windows: steps.optional(),
        macos: steps.optional(),
        linux: steps.optional(),
        android: steps.optional(),
        ios: steps.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const catalogEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string().min(1).max(120),
    category: z.enum(CATEGORIES),
    icon: z.string().regex(/^icons\/[a-z0-9-]+\.svg$/),
    image: z.string().refine(isPinnedImage, 'image tag must be pinned to a version, not latest'),
    containerPort: port,
    defaultHostPort: port,
    openPath: z.string().startsWith('/').optional(),
    env: z.record(envKey, z.string()).default({}),
    volumes: z.array(volumeSchema).default([]),
    fixedPorts: z.array(fixedPortSchema).default([]),
    generatedSecrets: z
      .array(z.object({ name: z.string().regex(/^[A-Za-z0-9]+$/), label: z.string().min(1), env: envKey }).strict())
      .default([]),
    guide: guideSchema,
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type Guide = CatalogEntry['guide'];
export type GuideStep = z.infer<typeof step>;
export type Volume = z.infer<typeof volumeSchema>;
export type FixedPort = z.infer<typeof fixedPortSchema>;
export type GeneratedSecret = CatalogEntry['generatedSecrets'][number];
```

- [ ] **Step 4: Implement the loader** — `src/catalog/catalog.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { catalogEntrySchema, type CatalogEntry } from './catalog.schema';

export * from './catalog.schema';

export class Catalog {
  private readonly byId: Map<string, CatalogEntry>;

  constructor(readonly entries: CatalogEntry[]) {
    this.byId = new Map(entries.map((entry) => [entry.id, entry]));
  }

  get(id: string): CatalogEntry | undefined {
    return this.byId.get(id);
  }
}

export function loadCatalog(dir: string): Catalog {
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort();
  const entries = files.map((file) => {
    const fail = (reason: string): never => {
      throw new Error(`Invalid catalog entry ${file}: ${reason}`);
    };
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      fail('not valid JSON');
    }
    const parsed = catalogEntrySchema.safeParse(raw);
    if (!parsed.success) {
      fail(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    const entry = parsed.data as CatalogEntry;
    if (`${entry.id}.json` !== file) fail(`file name must be ${entry.id}.json`);
    if (!fs.existsSync(path.join(dir, entry.icon))) fail(`icon ${entry.icon} not found`);
    return entry;
  });
  return new Catalog(entries);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx jest src/catalog && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/catalog
git commit -m "feat: add catalog schema and loader"
```

---

### Task 8: Catalog content — seven apps with guides and icons

**Files:**
- Create: `catalog/jellyfin.json`, `catalog/audiobookshelf.json`, `catalog/nextcloud.json`, `catalog/filebrowser.json`, `catalog/home-assistant.json`, `catalog/uptime-kuma.json`, `catalog/pihole.json`
- Create: `catalog/icons/<id>.svg` for each
- Create: `src/catalog/real-catalog.test.ts`

**Interfaces:**
- Consumes: Task 7 `loadCatalog`.
- Produces: catalog ids `jellyfin`, `audiobookshelf`, `nextcloud`, `filebrowser`, `home-assistant`, `uptime-kuma`, `pihole` (the Home empty state in Task 18 suggests `jellyfin`, `nextcloud`, `home-assistant`, `pihole`).

- [ ] **Step 1: Write the failing test** — `src/catalog/real-catalog.test.ts`:

```ts
import * as path from 'path';
import { loadCatalog } from './catalog';

const catalog = loadCatalog(path.resolve(__dirname, '..', '..', 'catalog'));

describe('shipped catalog', () => {
  it('contains the seven launch apps', () => {
    expect(catalog.entries.map((e) => e.id).sort()).toEqual(
      ['audiobookshelf', 'filebrowser', 'home-assistant', 'jellyfin', 'nextcloud', 'pihole', 'uptime-kuma'],
    );
  });

  it('gives every app a description and an after-install guide', () => {
    for (const entry of catalog.entries) {
      expect(entry.description.length).toBeGreaterThan(10);
      expect(entry.guide.afterInstall.length).toBeGreaterThan(0);
    }
  });

  it('uses distinct default host ports', () => {
    const ports = catalog.entries.map((e) => e.defaultHostPort);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('configures Pi-hole as DNS-only with port 53, a generated password and OS guides', () => {
    const pihole = catalog.get('pihole')!;
    expect(pihole.fixedPorts).toEqual([
      { containerPort: 53, hostPort: 53, protocol: 'tcp' },
      { containerPort: 53, hostPort: 53, protocol: 'udp' },
    ]);
    expect(pihole.generatedSecrets).toEqual([
      { name: 'adminPassword', label: 'Admin password', env: 'FTLCONF_webserver_api_password' },
    ]);
    expect(Object.keys(pihole.guide.server!.linux!)).toEqual(expect.arrayContaining(['default', 'ubuntu', 'fedora']));
    expect(pihole.guide.server!.windows).toBeDefined();
    expect(pihole.guide.server!.macos).toBeDefined();
    expect(Object.keys(pihole.guide.devices!)).toEqual(['router', 'windows', 'macos', 'linux', 'android', 'ios']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/catalog/real-catalog.test.ts`
Expected: FAIL — `ENOENT` on `catalog/`.

- [ ] **Step 3: Choose and verify image versions**

For each image below, pick the newest stable release tag available on the day of implementation and confirm it exists before writing it into the JSON. The versions listed are the minimum acceptable starting point:

| id | image | minimum tag |
|---|---|---|
| jellyfin | `jellyfin/jellyfin` | `10.10.7` |
| audiobookshelf | `ghcr.io/advplyr/audiobookshelf` | `2.19.5` |
| nextcloud | `nextcloud` | `31.0.2-apache` |
| filebrowser | `filebrowser/filebrowser` | `v2.32.0` |
| home-assistant | `ghcr.io/home-assistant/home-assistant` | `2025.3.4` |
| uptime-kuma | `louislam/uptime-kuma` | `1.23.16` |
| pihole | `pihole/pihole` | `2025.03.0` |

Verify a Docker Hub tag: `curl -fsS https://hub.docker.com/v2/repositories/<namespace>/<repo>/tags/<tag>` (official images use namespace `library`, e.g. `library/nextcloud`). Verify a GHCR tag: `docker manifest inspect <image>:<tag>` if Docker is available, otherwise the project's GitHub releases page. Record the chosen tags in the commit message.

For File Browser, read the release notes of the chosen version: if it creates a random admin password printed in the logs (v2.31 and later), use guide variant A below; if it still defaults to `admin`/`admin`, use variant B.

- [ ] **Step 4: Write the icons** — one monogram SVG per app, no external assets. Template (replace `LETTER` and `COLOR`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img"><rect width="64" height="64" rx="14" fill="COLOR"/><text x="32" y="42" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" font-weight="700" fill="#fff">LETTER</text></svg>
```

| file | LETTER | COLOR |
|---|---|---|
| `jellyfin.svg` | J | `#7b3fbf` |
| `audiobookshelf.svg` | A | `#1f7a6d` |
| `nextcloud.svg` | N | `#0a6bd1` |
| `filebrowser.svg` | F | `#3b7dd8` |
| `home-assistant.svg` | H | `#1a8fd6` |
| `uptime-kuma.svg` | U | `#2f9e57` |
| `pihole.svg` | P | `#a3123a` |

- [ ] **Step 5: Write the catalog entries.** Replace `<tag>` with the tag chosen in Step 3.

`catalog/jellyfin.json`:

```json
{
  "id": "jellyfin",
  "name": "Jellyfin",
  "description": "Stream your movies, shows and music to your TV, phone and computer.",
  "category": "Media",
  "icon": "icons/jellyfin.svg",
  "image": "jellyfin/jellyfin:<tag>",
  "containerPort": 8096,
  "defaultHostPort": 8096,
  "volumes": [
    { "name": "config", "containerPath": "/config" },
    { "name": "cache", "containerPath": "/cache" },
    { "name": "media", "containerPath": "/media" }
  ],
  "guide": {
    "afterInstall": [
      { "text": "Click Open. Jellyfin starts a short setup: pick your language and create your Jellyfin user." },
      { "text": "When asked to add a media library, choose the type (Movies, Shows, Music) and select the folder /media." },
      { "text": "Put your files in the media folder listed under Data on this page. Jellyfin picks them up on its next library scan." },
      { "text": "On a phone or TV, install the Jellyfin app and enter the address shown at the top of this page." }
    ]
  }
}
```

`catalog/audiobookshelf.json`:

```json
{
  "id": "audiobookshelf",
  "name": "Audiobookshelf",
  "description": "Your own library for audiobooks and podcasts, with progress synced across devices.",
  "category": "Media",
  "icon": "icons/audiobookshelf.svg",
  "image": "ghcr.io/advplyr/audiobookshelf:<tag>",
  "containerPort": 80,
  "defaultHostPort": 13378,
  "volumes": [
    { "name": "config", "containerPath": "/config" },
    { "name": "metadata", "containerPath": "/metadata" },
    { "name": "audiobooks", "containerPath": "/audiobooks" },
    { "name": "podcasts", "containerPath": "/podcasts" }
  ],
  "guide": {
    "afterInstall": [
      { "text": "Click Open and create the administrator account (the first account you create)." },
      { "text": "Go to Settings, then Libraries, and add a library. Use the folder /audiobooks for books or /podcasts for podcasts." },
      { "text": "Put your audiobook files in the audiobooks folder listed under Data on this page, then run a library scan." },
      { "text": "Install the Audiobookshelf app on your phone and enter the address shown at the top of this page." }
    ]
  }
}
```

`catalog/nextcloud.json`:

```json
{
  "id": "nextcloud",
  "name": "Nextcloud",
  "description": "Files, photos, calendar and contacts on your own server instead of someone else's cloud.",
  "category": "Files",
  "icon": "icons/nextcloud.svg",
  "image": "nextcloud:<tag>",
  "containerPort": 80,
  "defaultHostPort": 8080,
  "volumes": [{ "name": "html", "containerPath": "/var/www/html" }],
  "guide": {
    "afterInstall": [
      { "text": "Click Open and choose a username and password for the Nextcloud administrator." },
      { "text": "Leave the database set to SQLite: it is the simplest choice and works well for a household." },
      { "text": "Click Install and wait a minute while Nextcloud prepares itself." },
      { "text": "Open Nextcloud always with the address shown on this page: Nextcloud only trusts the address used during setup." },
      { "text": "Install the Nextcloud desktop or phone app and sign in with that same address." }
    ]
  }
}
```

`catalog/filebrowser.json` (variant A shown; for variant B replace the first two steps with the variant B text below):

```json
{
  "id": "filebrowser",
  "name": "File Browser",
  "description": "Upload, download and share files on your server from any browser.",
  "category": "Files",
  "icon": "icons/filebrowser.svg",
  "image": "filebrowser/filebrowser:<tag>",
  "containerPort": 80,
  "defaultHostPort": 8081,
  "volumes": [
    { "name": "files", "containerPath": "/srv" },
    { "name": "database", "containerPath": "/database" },
    { "name": "config", "containerPath": "/config" }
  ],
  "guide": {
    "afterInstall": [
      { "text": "Open the Logs section on this page and find the line that mentions the password: that is the first-time admin password." },
      { "text": "Click Open and log in with the username admin and that password." },
      { "text": "Change the password right away under Settings, then User Management." },
      { "text": "Files you upload are stored in the files folder listed under Data on this page." }
    ]
  }
}
```

Variant B first two steps: `{ "text": "Click Open and log in with the username admin and the password admin." }`, `{ "text": "Change the password right away under Settings, then User Management." }` (and drop the now-duplicated third step). Check the image documentation for the database location of the chosen version; if it expects `/database/filebrowser.db`, the `database` volume above covers it.

`catalog/home-assistant.json`:

```json
{
  "id": "home-assistant",
  "name": "Home Assistant",
  "description": "Control lights, sensors and smart devices from one place, without the vendor's cloud.",
  "category": "Smart home",
  "icon": "icons/home-assistant.svg",
  "image": "ghcr.io/home-assistant/home-assistant:<tag>",
  "containerPort": 8123,
  "defaultHostPort": 8123,
  "volumes": [{ "name": "config", "containerPath": "/config" }],
  "guide": {
    "afterInstall": [
      { "text": "Click Open. Home Assistant can take a few minutes the first time; refresh if the page does not load yet." },
      { "text": "Create your Home Assistant account and set your home location." },
      { "text": "Add devices under Settings, then Devices & services. Devices that are found automatically on the network may not appear; add them by their address instead." },
      { "text": "Install the Home Assistant app on your phone and enter the address shown at the top of this page." }
    ]
  }
}
```

`catalog/uptime-kuma.json`:

```json
{
  "id": "uptime-kuma",
  "name": "Uptime Kuma",
  "description": "Get alerted when a website, device or service at home stops responding.",
  "category": "Monitoring",
  "icon": "icons/uptime-kuma.svg",
  "image": "louislam/uptime-kuma:<tag>",
  "containerPort": 3001,
  "defaultHostPort": 3001,
  "volumes": [{ "name": "data", "containerPath": "/app/data" }],
  "guide": {
    "afterInstall": [
      { "text": "Click Open and create the administrator account." },
      { "text": "Click Add New Monitor, choose what to watch (a website, a device address) and how often to check it." },
      { "text": "Under Settings, then Notifications, connect the app you want alerts on (email, Telegram and many others)." }
    ]
  }
}
```

`catalog/pihole.json`:

```json
{
  "id": "pihole",
  "name": "Pi-hole",
  "description": "Block ads and trackers for every device in your home, including phones and TVs.",
  "category": "Network",
  "icon": "icons/pihole.svg",
  "image": "pihole/pihole:<tag>",
  "containerPort": 80,
  "defaultHostPort": 8082,
  "openPath": "/admin",
  "env": { "FTLCONF_dns_listeningMode": "all" },
  "volumes": [{ "name": "config", "containerPath": "/etc/pihole" }],
  "fixedPorts": [
    { "containerPort": 53, "hostPort": 53, "protocol": "tcp" },
    { "containerPort": 53, "hostPort": 53, "protocol": "udp" }
  ],
  "generatedSecrets": [
    { "name": "adminPassword", "label": "Admin password", "env": "FTLCONF_webserver_api_password" }
  ],
  "guide": {
    "afterInstall": [
      { "text": "Click Open and log in with the Admin password shown on this page." },
      { "text": "Tell your devices to use Pi-hole, following the steps under \"On your devices\" below. Changing the router covers every device at once." },
      { "text": "Check that it works: on the Pi-hole dashboard, Total queries starts growing as your devices browse." }
    ],
    "server": {
      "linux": {
        "default": [
          { "text": "Pi-hole needs port 53, the standard port for DNS. Most Linux systems leave it free, so there is usually nothing to do." },
          { "text": "If the install says port 53 is already used, open a terminal on the server and see which program holds it:", "command": "sudo ss -lunp 'sport = :53'" },
          { "text": "Stop or reconfigure that program, then install Pi-hole again." }
        ],
        "ubuntu": [
          { "text": "Ubuntu runs a small built-in DNS helper (systemd-resolved) on port 53. Pi-hole needs that port, so turn the helper's listener off. Open a terminal on the server and run:", "command": "sudo sed -r -i.orig 's/#?DNSStubListener=yes/DNSStubListener=no/g' /etc/systemd/resolved.conf" },
          { "text": "Point the system's DNS settings at the real resolver file:", "command": "sudo sh -c 'rm /etc/resolv.conf && ln -s /run/systemd/resolve/resolv.conf /etc/resolv.conf'" },
          { "text": "Restart the helper so the change takes effect:", "command": "sudo systemctl restart systemd-resolved" },
          { "text": "Come back to EasyHost and install Pi-hole." }
        ],
        "fedora": [
          { "text": "Fedora runs a small built-in DNS helper (systemd-resolved) on port 53. Pi-hole needs that port, so turn the helper's listener off. Open a terminal on the server and run:", "command": "sudo sed -r -i.orig 's/#?DNSStubListener=yes/DNSStubListener=no/g' /etc/systemd/resolved.conf" },
          { "text": "Point the system's DNS settings at the real resolver file:", "command": "sudo sh -c 'rm /etc/resolv.conf && ln -s /run/systemd/resolve/resolv.conf /etc/resolv.conf'" },
          { "text": "Restart the helper so the change takes effect:", "command": "sudo systemctl restart systemd-resolved" },
          { "text": "Come back to EasyHost and install Pi-hole." }
        ]
      },
      "windows": [
        { "text": "With Docker Desktop there is usually nothing to do on the server." },
        { "text": "If the install says port 53 is already used, the Windows feature Internet Connection Sharing may hold it. Open the Start menu, type Services and open it." },
        { "text": "Find Internet Connection Sharing (ICS), open it, click Stop and set Startup type to Disabled. Then install Pi-hole again." },
        { "text": "If Windows asks whether Docker Desktop may accept connections, allow it on private networks." }
      ],
      "macos": [
        { "text": "With Docker Desktop there is usually nothing to do on the server." },
        { "text": "If macOS asks whether Docker may accept incoming connections, click Allow." },
        { "text": "If the install says port 53 is already used, another DNS app is running on this Mac (for example a VPN or dnsmasq). Quit it and install Pi-hole again." }
      ]
    },
    "devices": {
      "router": [
        { "text": "Open your router's settings page in a browser. The address is usually printed on a label on the router, often http://192.168.1.1 or http://192.168.0.1." },
        { "text": "Find the DNS server setting for your home network. It is usually under LAN or DHCP settings, not under Internet or WAN." },
        { "text": "Set the primary DNS server to {serverAddress}. Leave the secondary DNS empty, otherwise devices may skip Pi-hole." },
        { "text": "Save, then turn Wi-Fi off and on again on your devices so they pick up the change." }
      ],
      "windows": [
        { "text": "Open Settings, then Network & internet, then Wi-Fi (or Ethernet), and click your network." },
        { "text": "Next to DNS server assignment click Edit, choose Manual and turn on IPv4." },
        { "text": "Set Preferred DNS to {serverAddress} and click Save." }
      ],
      "macos": [
        { "text": "Open System Settings, then Network, and select your Wi-Fi or Ethernet connection." },
        { "text": "Click Details, then DNS. Click + and enter {serverAddress}." },
        { "text": "Remove any other DNS servers in the list, then click OK." }
      ],
      "linux": [
        { "text": "Open Settings, then Wi-Fi or Network, and click the gear next to your connection." },
        { "text": "Open the IPv4 tab, turn off Automatic next to DNS and enter {serverAddress}." },
        { "text": "Click Apply, then disconnect and reconnect. Other desktops have the same option in their network settings." }
      ],
      "android": [
        { "text": "Android only lets you change DNS per Wi-Fi network together with a fixed IP address, which is fiddly. Changing the router instead is much easier." },
        { "text": "If you still want to: open Settings, then Network & internet, then Internet, and tap the gear next to your Wi-Fi." },
        { "text": "Tap Edit, open Advanced options, set IP settings to Static and enter {serverAddress} as DNS 1. Keep the IP address and gateway it suggests, then Save." }
      ],
      "ios": [
        { "text": "Open Settings, then Wi-Fi, and tap the (i) next to your network." },
        { "text": "Tap Configure DNS, choose Manual and delete the existing servers." },
        { "text": "Tap Add Server, enter {serverAddress} and tap Save." }
      ]
    }
  }
}
```

Before finishing this step, open Pi-hole's current Docker documentation for the chosen tag and confirm the two env variable names (`FTLCONF_webserver_api_password`, `FTLCONF_dns_listeningMode`) and the `/etc/pihole` volume. If any differ for that version, use the documented names and update the `generatedSecrets.env` value and the test in Step 1 accordingly.

- [ ] **Step 6: Run to verify pass**

Run: `npx jest src/catalog`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add catalog src/catalog/real-catalog.test.ts
git commit -m "feat: add launch catalog with guides and icons"
```

---

### Task 9: Server system detection

**Files:**
- Create: `src/system/system.ts`
- Create: `src/system/system.test.ts`

**Interfaces:**
- Produces:
  - `type ServerOs = 'linux' | 'windows' | 'macos' | 'other'`
  - `interface SystemInfo { os: ServerOs; distros: string[]; version: string }` — `distros` is `[ID, ...ID_LIKE]` lowercased, most specific first (the UI picks the first one that has a guide variant, else `default`)
  - `parseOsRelease(content: string): string[]`
  - `detectSystem(deps?: { platform?: NodeJS.Platform; readOsRelease?: () => string; readPackageJson?: () => string }): SystemInfo`

- [ ] **Step 1: Write the failing tests** — `src/system/system.test.ts`:

```ts
import { detectSystem, parseOsRelease } from './system';

const samples: Record<string, string> = {
  ubuntu: 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"\n',
  debian: 'PRETTY_NAME="Debian GNU/Linux 12"\nID=debian\n',
  fedora: 'NAME="Fedora Linux"\nID=fedora\nVERSION_ID=40\n',
  mint: 'NAME="Linux Mint"\nID=linuxmint\nID_LIKE="ubuntu debian"\n',
  raspbian: 'ID=raspbian\nID_LIKE=debian\n',
};

describe('parseOsRelease', () => {
  it.each([
    ['ubuntu', ['ubuntu', 'debian']],
    ['debian', ['debian']],
    ['fedora', ['fedora']],
    ['mint', ['linuxmint', 'ubuntu', 'debian']],
    ['raspbian', ['raspbian', 'debian']],
  ])('%s', (name, expected) => {
    expect(parseOsRelease(samples[name])).toEqual(expected);
  });

  it('returns an empty list for unknown content', () => {
    expect(parseOsRelease('garbage')).toEqual([]);
  });
});

describe('detectSystem', () => {
  const readPackageJson = () => JSON.stringify({ version: '0.2.0' });

  it('reports linux with distros', () => {
    expect(detectSystem({ platform: 'linux', readOsRelease: () => samples.ubuntu, readPackageJson })).toEqual({
      os: 'linux',
      distros: ['ubuntu', 'debian'],
      version: '0.2.0',
    });
  });

  it('falls back to no distros when /etc/os-release cannot be read', () => {
    const readOsRelease = () => {
      throw new Error('ENOENT');
    };
    expect(detectSystem({ platform: 'linux', readOsRelease, readPackageJson }).distros).toEqual([]);
  });

  it.each([
    ['win32', 'windows'],
    ['darwin', 'macos'],
    ['freebsd', 'other'],
  ] as const)('maps %s to %s', (platform, os) => {
    expect(detectSystem({ platform, readOsRelease: () => '', readPackageJson })).toMatchObject({ os, distros: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/system`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** — `src/system/system.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';

export type ServerOs = 'linux' | 'windows' | 'macos' | 'other';

export interface SystemInfo {
  os: ServerOs;
  distros: string[];
  version: string;
}

function readValue(content: string, key: string): string | undefined {
  const line = content.split('\n').find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^"|"$/g, '');
}

export function parseOsRelease(content: string): string[] {
  const id = readValue(content, 'ID');
  const idLike = readValue(content, 'ID_LIKE');
  return [id, ...(idLike ? idLike.split(/\s+/) : [])]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
}

export function detectSystem({
  platform = process.platform,
  readOsRelease = () => fs.readFileSync('/etc/os-release', 'utf8'),
  readPackageJson = () => fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'),
}: {
  platform?: NodeJS.Platform;
  readOsRelease?: () => string;
  readPackageJson?: () => string;
} = {}): SystemInfo {
  const os: ServerOs =
    platform === 'linux' ? 'linux' : platform === 'win32' ? 'windows' : platform === 'darwin' ? 'macos' : 'other';
  let distros: string[] = [];
  if (os === 'linux') {
    try {
      distros = parseOsRelease(readOsRelease());
    } catch {
      distros = [];
    }
  }
  const version = (JSON.parse(readPackageJson()) as { version: string }).version;
  return { os, distros, version };
}
```

`path.resolve(__dirname, '..', '..', 'package.json')` is the repo root both from `src/system/` and from the compiled `dist/system/`.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/system`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/system
git commit -m "feat: detect the server's operating system and distribution"
```

---

### Task 10: Host port checking and suggestions

**Files:**
- Create: `src/ports/port-checker.ts`
- Create: `src/ports/port-checker.test.ts`

**Interfaces:**
- Produces:
  - `type PortStatus = 'free' | 'in-use' | 'unknown'`
  - `classifyBindError(err: NodeJS.ErrnoException): PortStatus` — `EADDRINUSE` → `in-use`, anything else (including `EACCES`) → `unknown`
  - `interface IPortChecker { check(port: number, protocol: 'tcp' | 'udp'): Promise<PortStatus>; suggest(preferred: number, used: Set<number>): Promise<number> }`
  - `class PortChecker implements IPortChecker` with `constructor(host = '0.0.0.0')`

- [ ] **Step 1: Write the failing tests** — `src/ports/port-checker.test.ts`:

```ts
import * as dgram from 'dgram';
import * as net from 'net';
import { PortChecker, classifyBindError } from './port-checker';

function listenTcp(): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen({ port: 0, host: '0.0.0.0' }, () => resolve(server));
  });
}

function bindUdp(): Promise<dgram.Socket> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.bind({ port: 0, address: '0.0.0.0' }, () => resolve(socket));
  });
}

describe('classifyBindError', () => {
  it.each([
    ['EADDRINUSE', 'in-use'],
    ['EACCES', 'unknown'],
    ['EADDRNOTAVAIL', 'unknown'],
  ])('%s → %s', (code, expected) => {
    expect(classifyBindError(Object.assign(new Error(code), { code }))).toBe(expected);
  });
});

describe('PortChecker', () => {
  const checker = new PortChecker();

  it('reports a bound TCP port as in-use and free once released', async () => {
    const server = await listenTcp();
    const port = (server.address() as net.AddressInfo).port;
    await expect(checker.check(port, 'tcp')).resolves.toBe('in-use');
    await new Promise((r) => server.close(r));
    await expect(checker.check(port, 'tcp')).resolves.toBe('free');
  });

  it('reports a bound UDP port as in-use', async () => {
    const socket = await bindUdp();
    const port = socket.address().port;
    await expect(checker.check(port, 'udp')).resolves.toBe('in-use');
    socket.close();
  });

  it('suggests the next port that is neither used by an app nor bound on the host', async () => {
    const server = await listenTcp();
    const bound = (server.address() as net.AddressInfo).port;
    const suggested = await checker.suggest(bound, new Set([bound + 1]));
    expect(suggested).toBeGreaterThanOrEqual(bound + 2);
    await new Promise((r) => server.close(r));
  });

  it('returns the preferred port when it is free', async () => {
    const server = await listenTcp();
    const port = (server.address() as net.AddressInfo).port;
    await new Promise((r) => server.close(r));
    await expect(checker.suggest(port, new Set())).resolves.toBe(port);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/ports`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement** — `src/ports/port-checker.ts`:

```ts
import * as dgram from 'dgram';
import * as net from 'net';
import { ValidationError } from '../errors';

export type PortStatus = 'free' | 'in-use' | 'unknown';

export interface IPortChecker {
  check(port: number, protocol: 'tcp' | 'udp'): Promise<PortStatus>;
  suggest(preferred: number, used: Set<number>): Promise<number>;
}

/**
 * EACCES is expected for ports below 1024 when EasyHost does not run as
 * root: the port may well be free, so it is "unknown", not "in-use", and the
 * install goes ahead; Docker reports a real conflict itself.
 */
export function classifyBindError(err: NodeJS.ErrnoException): PortStatus {
  return err.code === 'EADDRINUSE' ? 'in-use' : 'unknown';
}

export class PortChecker implements IPortChecker {
  constructor(private readonly host = '0.0.0.0') {}

  check(port: number, protocol: 'tcp' | 'udp'): Promise<PortStatus> {
    return protocol === 'tcp' ? this.checkTcp(port) : this.checkUdp(port);
  }

  async suggest(preferred: number, used: Set<number>): Promise<number> {
    for (let port = preferred; port <= 65535; port++) {
      if (used.has(port)) continue;
      if ((await this.check(port, 'tcp')) !== 'in-use') return port;
    }
    throw new ValidationError(`No free port found from ${preferred} upward`);
  }

  private checkTcp(port: number): Promise<PortStatus> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: NodeJS.ErrnoException) => resolve(classifyBindError(err)));
      server.listen({ port, host: this.host, exclusive: true }, () => server.close(() => resolve('free')));
    });
  }

  private checkUdp(port: number): Promise<PortStatus> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      socket.once('error', (err: NodeJS.ErrnoException) => {
        socket.close();
        resolve(classifyBindError(err));
      });
      socket.bind({ port, address: this.host, exclusive: true }, () => socket.close(() => resolve('free')));
    });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/ports`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ports
git commit -m "feat: check host port availability and suggest free ports"
```

---

### Task 11: Docker mounts, fixed ports and port conflicts

**Files:**
- Modify: `src/docker/docker.types.ts:37-45`
- Modify: `src/docker/docker.service.ts` (`CreateAndStartOptions`, `createAndStart`)
- Modify: `src/docker/docker.service.test.ts`

**Interfaces:**
- Consumes: Task 5 `PortInUseError`; Task 7 `FixedPort`.
- Produces: `CreateAndStartOptions` gains `mounts?: Array<{ hostPath: string; containerPath: string }>` and `fixedPorts?: FixedPort[]`. `createAndStart` throws `PortInUseError(port, protocol)` when Docker reports a port conflict (after the usual best-effort cleanup).

- [ ] **Step 1: Write the failing tests** — add to `src/docker/docker.service.test.ts`, reusing the file's existing dockerode mock factory (the one used by the current `createAndStart` tests):

```ts
  describe('createAndStart with mounts and fixed ports', () => {
    it('passes bind mounts through the Mounts API, keeping spaces and accents intact', async () => {
      const { docker, container } = makeDockerMock();
      const service = new DockerService(docker);
      await service.createAndStart({
        name: 'jf',
        image: 'jellyfin/jellyfin:10.10.7',
        hostPort: 8096,
        containerPort: 8096,
        mounts: [{ hostPath: 'C:\\Users\\Raoul Salvadé\\data\\apps\\abc\\config', containerPath: '/config' }],
      });
      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Mounts: [{ Type: 'bind', Source: 'C:\\Users\\Raoul Salvadé\\data\\apps\\abc\\config', Target: '/config' }],
          }),
        }),
      );
      expect(container.start).toHaveBeenCalled();
    });

    it('publishes fixed TCP and UDP ports on the bind address', async () => {
      const { docker } = makeDockerMock();
      const service = new DockerService(docker, { bindAddress: '0.0.0.0' });
      await service.createAndStart({
        name: 'pihole',
        image: 'pihole/pihole:2025.03.0',
        hostPort: 8082,
        containerPort: 80,
        fixedPorts: [
          { containerPort: 53, hostPort: 53, protocol: 'tcp' },
          { containerPort: 53, hostPort: 53, protocol: 'udp' },
        ],
      });
      const options = docker.createContainer.mock.calls[0][0];
      expect(options.ExposedPorts).toEqual({ '80/tcp': {}, '53/tcp': {}, '53/udp': {} });
      expect(options.HostConfig.PortBindings).toEqual({
        '80/tcp': [{ HostPort: '8082', HostIp: '0.0.0.0' }],
        '53/tcp': [{ HostPort: '53', HostIp: '0.0.0.0' }],
        '53/udp': [{ HostPort: '53', HostIp: '0.0.0.0' }],
      });
    });

    it.each([
      ['driver failed programming external connectivity on endpoint x: Bind for 0.0.0.0:53 failed: port is already allocated', 53, 'tcp'],
      ['Error starting userland proxy: listen udp4 0.0.0.0:53: bind: address already in use', 53, 'udp'],
      ['Error starting userland proxy: listen tcp4 0.0.0.0:8096: bind: address already in use', 8096, 'tcp'],
    ])('maps "%s" to PortInUseError(%d, %s) and still cleans up', async (message, port, protocol) => {
      const { docker, container } = makeDockerMock();
      container.start.mockRejectedValue(Object.assign(new Error(message), { statusCode: 500 }));
      const service = new DockerService(docker);
      await expect(
        service.createAndStart({ name: 'x', image: 'x:1', hostPort: 8096, containerPort: 8096 }),
      ).rejects.toMatchObject({ code: 'PORT_IN_USE', details: { port, protocol } });
      expect(container.remove).toHaveBeenCalledWith({ force: true });
    });
  });
```

If the file's existing mock factory has a different name or shape, adapt these tests to it rather than adding a second factory; the factory must return a `docker` whose `createContainer` resolves a `container` with jest-mock `start` and `remove`.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/docker`
Expected: FAIL — `Mounts` missing from the create options.

- [ ] **Step 3: Implement** — in `src/docker/docker.types.ts` replace `HostConfig` in `CreateContainerOptions`:

```ts
  HostConfig?: {
    PortBindings?: Record<string, Array<{ HostPort: string; HostIp?: string }>>;
    Mounts?: Array<{ Type: 'bind'; Source: string; Target: string }>;
  };
```

In `src/docker/docker.service.ts`:

```ts
import { ContainerMissingError, DockerOperationError, DockerUnavailableError, PortInUseError } from '../errors';
import type { FixedPort } from '../catalog/catalog.schema';
```

```ts
export interface CreateAndStartOptions {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  env?: Record<string, string>;
  mounts?: Array<{ hostPath: string; containerPath: string }>;
  fixedPorts?: FixedPort[];
}

const PORT_CONFLICT = /port is already allocated|address already in use/i;

function portConflictFrom(err: unknown, fallbackPort: number): PortInUseError | undefined {
  if (!(err instanceof Error) || !PORT_CONFLICT.test(err.message)) return undefined;
  // The port follows the bound address, e.g. "0.0.0.0:53" or "[::]:53".
  const port = /(?:\d{1,3}(?:\.\d{1,3}){3}|\])\:(\d{1,5})/.exec(err.message);
  const protocol = /udp/i.test(err.message) ? 'udp' : 'tcp';
  return new PortInUseError(port ? Number(port[1]) : fallbackPort, protocol);
}
```

Replace `createAndStart`:

```ts
  async createAndStart(options: CreateAndStartOptions): Promise<string> {
    const { name, image, hostPort, containerPort, env, mounts = [], fixedPorts = [] } = options;
    const published = [
      { containerPort, hostPort, protocol: 'tcp' as const },
      ...fixedPorts,
    ];
    const exposedPorts: Record<string, unknown> = {};
    const portBindings: Record<string, Array<{ HostPort: string; HostIp: string }>> = {};
    for (const p of published) {
      const key = `${p.containerPort}/${p.protocol}`;
      exposedPorts[key] = {};
      portBindings[key] = [...(portBindings[key] ?? []), { HostPort: String(p.hostPort), HostIp: this.bindAddress }];
    }

    const container = await this.docker.createContainer({
      name,
      Image: image,
      Env: toEnvArray(env),
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Mounts: mounts.map((m) => ({ Type: 'bind' as const, Source: m.hostPath, Target: m.containerPath })),
      },
    });

    try {
      await container.start();
    } catch (err) {
      const translated = portConflictFrom(err, hostPort) ?? this.translateError(err);
      try {
        await container.remove({ force: true });
      } catch {
        // Best-effort cleanup failed too: keep the id (never in the message)
        // so callers can persist it and remove the container later.
        translated.containerId = container.id;
      }
      throw translated;
    }

    return container.id;
  }
```

The regex in `portConflictFrom` anchors on the bound address so an earlier colon in Docker's message (for example `endpoint x:`) is never mistaken for the port.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/docker && npm run typecheck`
Expected: PASS (existing `createAndStart` tests may need their `HostConfig` expectation extended with `Mounts: []`).

- [ ] **Step 5: Commit**

```bash
git add src/docker
git commit -m "feat: support data mounts and fixed ports, report port conflicts"
```

---

### Task 12: Background installs with readable errors

**Files:**
- Modify: `src/apps/app.types.ts`
- Modify: `src/apps/app.service.ts`
- Modify: `src/apps/app.service.test.ts`

**Interfaces:**
- Consumes: Task 5 `PortInUseError`, `DockerUnavailableError`; Task 7 `Volume`, `FixedPort`; Task 11 `CreateAndStartOptions.mounts/fixedPorts`.
- Produces:
  - `CreateAppInput` gains `catalogId?: string; volumes?: Volume[]; fixedPorts?: FixedPort[]; secrets?: Record<string, string>`
  - `AppService.create(input)` resolves with the `PENDING` row immediately; the install runs in the background
  - `AppService.settled(): Promise<void>` — resolves when every background install has finished (tests, shutdown)
  - `AppService.recoverInterruptedInstalls(): Promise<number>`
  - `INSTALL_MESSAGES` (exported object of the four `lastError` texts below)
  - `start`/`stop` clear `lastError` on success
  - constructor unchanged in this task: `(prisma, docker)`; Task 13 adds the data store.

`lastError` texts (exact):

```ts
export const INSTALL_MESSAGES = {
  dockerDown: "Docker isn't running on the server, so the app couldn't be installed.",
  download: "Couldn't download the app. Check that the server is connected to the internet.",
  start: 'The app was downloaded but could not start.',
  interrupted: 'Installation was interrupted.',
  portInUse: (port: number) => `Port ${port} is already used by another program on the server.`,
};
```

- [ ] **Step 1: Rewrite the create tests** — in `src/apps/app.service.test.ts`, replace every existing test that expects `create()` to reject on a Docker failure. The new expectations (add a `deferred` helper at the top of the file):

```ts
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

```ts
  describe('background install', () => {
    let seq = 0;

    it('returns the PENDING row before the download finishes, then becomes RUNNING', async () => {
      const pull = deferred();
      docker.pullImage.mockReturnValue(pull.promise);
      docker.createAndStart.mockResolvedValue('container-1');

      const app = await service.create(input({ name: 'bg-ok', hostPort: 9101 }));
      expect(app.status).toBe('PENDING');

      pull.resolve();
      await service.settled();
      const row = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(row).toMatchObject({ status: 'RUNNING', containerId: 'container-1', lastError: null });
    });

    it.each([
      ['a download failure', 'pull', new DockerOperationError('manifest unknown raw-docker-text'), INSTALL_MESSAGES.download],
      ['Docker being down', 'pull', new DockerUnavailableError('connect ENOENT raw-docker-text'), INSTALL_MESSAGES.dockerDown],
      ['a start failure', 'start', new DockerOperationError('OCI runtime raw-docker-text'), INSTALL_MESSAGES.start],
      ['a port conflict', 'start', new PortInUseError(8096, 'tcp'), INSTALL_MESSAGES.portInUse(8096)],
    ])('stores a readable lastError for %s and never the raw text', async (_label, stage, error, message) => {
      if (stage === 'pull') docker.pullImage.mockRejectedValue(error);
      else {
        docker.pullImage.mockResolvedValue();
        docker.createAndStart.mockRejectedValue(error);
      }
      seq += 1;
      const app = await service.create(input({ name: `bg-fail-${seq}`, hostPort: 9200 + seq }));
      await service.settled();
      const row = await prisma.app.findUniqueOrThrow({ where: { id: app.id } });
      expect(row.status).toBe('ERROR');
      expect(row.lastError).toBe(message);
      expect(row.lastError).not.toContain('raw-docker-text');
    });

    it('keeps the orphaned container id when start and cleanup both failed', async () => {
      docker.pullImage.mockResolvedValue();
      const err = new DockerOperationError('boom');
      err.containerId = 'orphan-1';
      docker.createAndStart.mockRejectedValue(err);
      const app = await service.create(input({ name: 'bg-orphan', hostPort: 9701 }));
      await service.settled();
      await expect(prisma.app.findUniqueOrThrow({ where: { id: app.id } })).resolves.toMatchObject({
        status: 'ERROR',
        containerId: 'orphan-1',
      });
    });

    it('removes the new container if the app was deleted while installing', async () => {
      const pull = deferred();
      docker.pullImage.mockReturnValue(pull.promise);
      docker.createAndStart.mockResolvedValue('late-container');
      const app = await service.create(input({ name: 'bg-deleted', hostPort: 9702 }));
      await prisma.app.delete({ where: { id: app.id } });
      pull.resolve();
      await service.settled();
      expect(docker.remove).toHaveBeenCalledWith('late-container', { force: true });
    });

    it('marks installs left PENDING by a restart as interrupted', async () => {
      const row = await prisma.app.create({
        data: { name: 'bg-stale', image: 'x:1', hostPort: 9703, containerPort: 80, status: 'PENDING' },
      });
      await expect(service.recoverInterruptedInstalls()).resolves.toBeGreaterThanOrEqual(1);
      await expect(prisma.app.findUniqueOrThrow({ where: { id: row.id } })).resolves.toMatchObject({
        status: 'ERROR',
        lastError: INSTALL_MESSAGES.interrupted,
      });
    });

    it('clears lastError when the app starts again', async () => {
      const row = await prisma.app.create({
        data: { name: 'bg-restart', image: 'x:1', hostPort: 9704, containerPort: 80, status: 'ERROR', containerId: 'c-restart', lastError: 'old' },
      });
      docker.start.mockResolvedValue();
      await expect(service.start(row.id)).resolves.toMatchObject({ status: 'RUNNING', lastError: null });
    });
  });
```

`input(overrides)` is a small factory returning a valid `CreateAppInput` (`image: 'nginx:1.27'`, `containerPort: 80`); add it if the file does not already have one. `docker` is the file's existing hand-rolled `IDockerService` mock. Use distinct names and host ports per test so rows never collide inside the shared temp database.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/apps`
Expected: FAIL — `create` still awaits the install and `INSTALL_MESSAGES` is not exported.

- [ ] **Step 3: Implement** — extend `src/apps/app.types.ts`:

```ts
import type { FixedPort, Volume } from '../catalog/catalog.schema';

export interface CreateAppInput {
  name: string;
  image: string;
  hostPort: number;
  containerPort: number;
  env?: Record<string, string>;
  catalogId?: string;
  volumes?: Volume[];
  fixedPorts?: FixedPort[];
  secrets?: Record<string, string>;
}
```

In `src/apps/app.service.ts`:

- export `INSTALL_MESSAGES` (text above) and import `DockerUnavailableError`, `PortInUseError`;
- add `private readonly inflight = new Set<Promise<void>>();`
- replace `create`:

```ts
  async create(input: CreateAppInput): Promise<App> {
    await this.checkConflict(input.name, input.hostPort);
    let app: App;
    try {
      app = await this.prisma.app.create({
        data: {
          name: input.name,
          image: input.image,
          hostPort: input.hostPort,
          containerPort: input.containerPort,
          status: 'PENDING',
          catalogId: input.catalogId ?? null,
          volumes: JSON.stringify(input.volumes ?? []),
          fixedPorts: JSON.stringify(input.fixedPorts ?? []),
          secrets: JSON.stringify(input.secrets ?? {}),
        },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw conflictFromUniqueConstraintError(err, input);
      }
      throw err;
    }
    const job = this.install(app.id, input).finally(() => this.inflight.delete(job));
    this.inflight.add(job);
    return app;
  }

  async settled(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  async recoverInterruptedInstalls(): Promise<number> {
    const { count } = await this.prisma.app.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'ERROR', lastError: INSTALL_MESSAGES.interrupted },
    });
    return count;
  }

  /** Never throws: every outcome is written to the row. */
  private async install(id: string, input: CreateAppInput): Promise<void> {
    let stage: 'pull' | 'start' = 'pull';
    let containerId: string | undefined;
    try {
      await this.docker.pullImage(input.image);
      stage = 'start';
      containerId = await this.docker.createAndStart({
        name: input.name,
        image: input.image,
        hostPort: input.hostPort,
        containerPort: input.containerPort,
        env: input.env,
        fixedPorts: input.fixedPorts,
        mounts: await this.mountsFor(id, input),
      });
      await this.prisma.app.update({ where: { id }, data: { containerId, status: 'RUNNING', lastError: null } });
    } catch (err) {
      if (isRecordNotFoundError(err) && containerId) {
        // The app was removed while installing: do not leave its container behind.
        await this.docker.remove(containerId, { force: true }).catch((e) => console.error(e));
        return;
      }
      console.error(err);
      const idFromError = err instanceof AppError ? err.containerId : undefined;
      await this.prisma.app
        .update({
          where: { id },
          data: { status: 'ERROR', containerId: containerId ?? idFromError ?? null, lastError: installMessage(err, stage) },
        })
        .catch((e) => console.error(e));
    }
  }

  /** Task 13 replaces this with real data folders. */
  protected async mountsFor(_id: string, _input: CreateAppInput): Promise<Array<{ hostPath: string; containerPath: string }>> {
    return [];
  }
```

Module-level helper:

```ts
function installMessage(err: unknown, stage: 'pull' | 'start'): string {
  if (err instanceof DockerUnavailableError) return INSTALL_MESSAGES.dockerDown;
  if (err instanceof PortInUseError) return INSTALL_MESSAGES.portInUse(Number(err.details?.port));
  return stage === 'pull' ? INSTALL_MESSAGES.download : INSTALL_MESSAGES.start;
}
```

In `start` and `stop`, change the final updates to `data: { status: 'RUNNING', lastError: null }` and `data: { status: 'STOPPED', lastError: null }`.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/apps && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps
git commit -m "feat: install apps in the background with readable errors"
```

---

### Task 13: Per-app data folders and optional data deletion

**Files:**
- Create: `src/apps/app-data.ts`
- Create: `src/apps/app-data.test.ts`
- Modify: `src/apps/app.service.ts` (constructor, `mountsFor`, `remove`)
- Modify: `src/apps/app.service.test.ts`

**Interfaces:**
- Consumes: Task 7 `Volume`; Task 12 `mountsFor` hook.
- Produces:
  - `class AppDataStore` with `constructor(dataDir: string, options?: { rm?: typeof fs.promises.rm })`
  - `appDir(appId: string): string` — throws for ids that are not `/^[A-Za-z0-9]+$/`
  - `ensure(appId: string, volumes: Volume[]): Promise<Array<{ hostPath: string; containerPath: string }>>`
  - `remove(appId: string): Promise<{ deleted: boolean; path: string }>`
  - `interface RemoveResult { dataPath: string; dataDeleted: boolean }`
  - `IAppService.remove(id: string, options?: { deleteData?: boolean }): Promise<RemoveResult>`
  - `AppService` constructor becomes `(prisma, docker, dataStore: AppDataStore)`

- [ ] **Step 1: Write the failing tests** — `src/apps/app-data.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppDataStore } from './app-data';

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost data é '));
}

describe('AppDataStore', () => {
  it('creates one folder per volume under DATA_DIR/apps/<id>', async () => {
    const dataDir = tempDataDir();
    const store = new AppDataStore(dataDir);
    const mounts = await store.ensure('abc123', [
      { name: 'config', containerPath: '/config' },
      { name: 'media', containerPath: '/media' },
    ]);
    expect(mounts).toEqual([
      { hostPath: path.join(dataDir, 'apps', 'abc123', 'config'), containerPath: '/config' },
      { hostPath: path.join(dataDir, 'apps', 'abc123', 'media'), containerPath: '/media' },
    ]);
    expect(fs.statSync(mounts[1].hostPath).isDirectory()).toBe(true);
  });

  it('deletes only the app folder', async () => {
    const dataDir = tempDataDir();
    const store = new AppDataStore(dataDir);
    await store.ensure('keep1', [{ name: 'config', containerPath: '/config' }]);
    await store.ensure('drop1', [{ name: 'config', containerPath: '/config' }]);
    await expect(store.remove('drop1')).resolves.toEqual({ deleted: true, path: path.join(dataDir, 'apps', 'drop1') });
    expect(fs.existsSync(path.join(dataDir, 'apps', 'drop1'))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, 'apps', 'keep1'))).toBe(true);
  });

  it.each(['..', '../x', 'a/b', 'a\\b', '', '.'])('refuses the unsafe id %p', (id) => {
    const store = new AppDataStore(tempDataDir());
    expect(() => store.appDir(id)).toThrow();
  });

  it('reports a deletion failure instead of throwing', async () => {
    const dataDir = tempDataDir();
    const rm = jest.fn().mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));
    const store = new AppDataStore(dataDir, { rm });
    await store.ensure('busy1', [{ name: 'config', containerPath: '/config' }]);
    await expect(store.remove('busy1')).resolves.toEqual({ deleted: false, path: path.join(dataDir, 'apps', 'busy1') });
  });
});
```

Add to `src/apps/app.service.test.ts` (construct the service with a real `AppDataStore` on a temp dir):

```ts
  describe('data folders', () => {
    it('mounts data folders when installing and keeps them on removal', async () => {
      docker.pullImage.mockResolvedValue();
      docker.createAndStart.mockResolvedValue('c-data-1');
      docker.remove.mockResolvedValue();
      const app = await service.create(input({ name: 'data-keep', hostPort: 9801, volumes: [{ name: 'config', containerPath: '/config' }] }));
      await service.settled();
      const mounts = docker.createAndStart.mock.calls.at(-1)![0].mounts!;
      expect(mounts[0].hostPath).toBe(path.join(dataDir, 'apps', app.id, 'config'));

      const result = await service.remove(app.id);
      expect(result).toEqual({ dataPath: path.join(dataDir, 'apps', app.id), dataDeleted: false });
      expect(fs.existsSync(mounts[0].hostPath)).toBe(true);
    });

    it('deletes data only when asked', async () => {
      docker.pullImage.mockResolvedValue();
      docker.createAndStart.mockResolvedValue('c-data-2');
      docker.remove.mockResolvedValue();
      const app = await service.create(input({ name: 'data-drop', hostPort: 9802, volumes: [{ name: 'config', containerPath: '/config' }] }));
      await service.settled();
      const result = await service.remove(app.id, { deleteData: true });
      expect(result.dataDeleted).toBe(true);
      expect(fs.existsSync(path.join(dataDir, 'apps', app.id))).toBe(false);
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/apps`
Expected: FAIL — cannot find module `./app-data`.

- [ ] **Step 3: Implement** — `src/apps/app-data.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { Volume } from '../catalog/catalog.schema';

const SAFE_ID = /^[A-Za-z0-9]+$/;

export class AppDataStore {
  private readonly appsRoot: string;
  private readonly rm: typeof fs.promises.rm;

  constructor(dataDir: string, { rm = fs.promises.rm }: { rm?: typeof fs.promises.rm } = {}) {
    this.appsRoot = path.resolve(dataDir, 'apps');
    this.rm = rm;
  }

  appDir(appId: string): string {
    if (!SAFE_ID.test(appId)) {
      throw new Error(`Refusing unsafe app id for data folder: ${JSON.stringify(appId)}`);
    }
    const dir = path.resolve(this.appsRoot, appId);
    if (path.dirname(dir) !== this.appsRoot) {
      throw new Error(`Data folder escapes ${this.appsRoot}`);
    }
    return dir;
  }

  async ensure(appId: string, volumes: Volume[]): Promise<Array<{ hostPath: string; containerPath: string }>> {
    const dir = this.appDir(appId);
    return Promise.all(
      volumes.map(async (volume) => {
        const hostPath = path.join(dir, volume.name);
        await fs.promises.mkdir(hostPath, { recursive: true });
        return { hostPath, containerPath: volume.containerPath };
      }),
    );
  }

  async remove(appId: string): Promise<{ deleted: boolean; path: string }> {
    const dir = this.appDir(appId);
    try {
      await this.rm(dir, { recursive: true, force: true });
      return { deleted: true, path: dir };
    } catch (err) {
      console.error(err);
      return { deleted: false, path: dir };
    }
  }
}
```

In `src/apps/app.service.ts`:

```ts
export interface RemoveResult {
  dataPath: string;
  dataDeleted: boolean;
}
```

- change `IAppService.remove` to `remove(id: string, options?: { deleteData?: boolean }): Promise<RemoveResult>;`
- constructor: add `private readonly dataStore: AppDataStore` as third parameter;
- replace `mountsFor` body with `return this.dataStore.ensure(id, input.volumes ?? []);` (drop `protected` placeholder wording);
- replace `remove`:

```ts
  async remove(id: string, { deleteData = false }: { deleteData?: boolean } = {}): Promise<RemoveResult> {
    const app = await this.getOrThrow(id);
    if (app.containerId) {
      await this.docker.remove(app.containerId, { force: true });
    }
    await this.prisma.app.delete({ where: { id } });
    const dataPath = this.dataStore.appDir(id);
    if (!deleteData) {
      return { dataPath, dataDeleted: false };
    }
    const { deleted } = await this.dataStore.remove(id);
    return { dataPath, dataDeleted: deleted };
  }
```

Update every `new AppService(prisma, docker)` in tests to pass `new AppDataStore(dataDir)` with a temp `dataDir`, and `src/index.ts` to pass `new AppDataStore(config.dataDir)`. In `src/http/apps.router.ts` keep `DELETE` compiling for now: `await appService.remove(req.params.id); res.status(204).send();` (Task 14 changes the response).

- [ ] **Step 4: Run to verify pass**

Run: `npx jest && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apps src/index.ts src/http/apps.router.ts
git commit -m "feat: keep app data in per-app folders, delete only on request"
```

---

### Task 14: Install planner, app views and the apps router

**Files:**
- Create: `src/apps/install-planner.ts`
- Create: `src/apps/install-planner.test.ts`
- Create: `src/apps/app.view.ts`
- Modify: `src/http/apps.router.ts`
- Modify: `src/http/server.ts`, `src/http/server.test.ts`, `src/http/auth.router.test.ts` (new deps)

**Interfaces:**
- Consumes: Task 7 `Catalog`, `CatalogEntry`, `Volume`; Task 10 `IPortChecker`; Task 12 `CreateAppInput`; Task 13 `AppDataStore`, `RemoveResult`.
- Produces:
  - `type InstallRequest = { catalogId: string; name?: string; hostPort?: number } | { name: string; image: string; hostPort: number; containerPort?: number; env?: Record<string, string>; volumes?: Volume[] }`
  - `interface IInstallPlanner { plan(request: InstallRequest): Promise<CreateAppInput> }`, `class InstallPlanner` with `constructor(prisma: PrismaClient, catalog: Catalog, ports: IPortChecker)`
  - `APP_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/` and `APP_NAME_MESSAGE = 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number (no spaces).'`
  - `interface AppView { id; name; image; status; hostPort; containerPort; catalogId: string | null; lastError: string | null; openPath: string; fixedPorts: FixedPort[]; dataPath: string; volumes: Array<Volume & { hostPath: string }>; createdAt; updatedAt }` — no `containerId`, no secrets
  - `interface AppDetailView extends AppView { secrets: Array<{ name: string; label: string; value: string }> }`
  - `toAppView(app: App, ctx: ViewContext): AppView`, `toAppDetailView(app: App, ctx: ViewContext): AppDetailView`, `interface ViewContext { catalog: Catalog; dataStore: AppDataStore }`
  - `createAppsRouter(deps: { appService: IAppService; planner: IInstallPlanner; views: ViewContext }): Router`
  - `ServerDeps` gains `planner: IInstallPlanner`, `views: ViewContext`
  - `test/helpers/views.ts`: `makeViewContext(): ViewContext` (empty catalog, temp data dir)

- [ ] **Step 1: Write the failing planner tests** — `src/apps/install-planner.test.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { createTempDb } from '../../test/helpers/temp-db';
import { Catalog, type CatalogEntry } from '../catalog/catalog';
import type { IPortChecker, PortStatus } from '../ports/port-checker';
import { InstallPlanner } from './install-planner';

const pihole: CatalogEntry = {
  id: 'pihole',
  name: 'Pi-hole',
  description: 'Blocks ads.',
  category: 'Network',
  icon: 'icons/pihole.svg',
  image: 'pihole/pihole:2025.03.0',
  containerPort: 80,
  defaultHostPort: 8082,
  openPath: '/admin',
  env: { FTLCONF_dns_listeningMode: 'all' },
  volumes: [{ name: 'config', containerPath: '/etc/pihole' }],
  fixedPorts: [
    { containerPort: 53, hostPort: 53, protocol: 'tcp' },
    { containerPort: 53, hostPort: 53, protocol: 'udp' },
  ],
  generatedSecrets: [{ name: 'adminPassword', label: 'Admin password', env: 'FTLCONF_webserver_api_password' }],
  guide: { afterInstall: [{ text: 'Open it.' }] },
};

function fakePorts(statuses: Record<string, PortStatus> = {}): jest.Mocked<IPortChecker> {
  return {
    check: jest.fn(async (port: number, protocol: 'tcp' | 'udp') => statuses[`${port}/${protocol}`] ?? 'free'),
    suggest: jest.fn(async (preferred: number, used: Set<number>) => {
      let p = preferred;
      while (used.has(p)) p++;
      return p;
    }),
  };
}

describe('InstallPlanner', () => {
  let prisma: PrismaClient;
  let cleanup: () => Promise<void>;

  beforeAll(() => {
    ({ prisma, cleanup } = createTempDb());
  });
  afterAll(async () => cleanup());
  beforeEach(async () => {
    await prisma.app.deleteMany();
  });

  it('plans a catalog install with the default name, a suggested port, env and a generated secret', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts());
    const plan = await planner.plan({ catalogId: 'pihole' });
    expect(plan).toMatchObject({
      name: 'pihole',
      image: 'pihole/pihole:2025.03.0',
      hostPort: 8082,
      containerPort: 80,
      catalogId: 'pihole',
      volumes: pihole.volumes,
      fixedPorts: pihole.fixedPorts,
    });
    expect(plan.secrets!.adminPassword).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(plan.env).toEqual({
      FTLCONF_dns_listeningMode: 'all',
      FTLCONF_webserver_api_password: plan.secrets!.adminPassword,
    });
  });

  it('adds a numeric suffix when the default name is taken and skips ports used by apps', async () => {
    await prisma.app.create({ data: { name: 'pihole', image: 'x:1', hostPort: 8082, containerPort: 80, status: 'STOPPED' } });
    const planner = new InstallPlanner(prisma, new Catalog([{ ...pihole, fixedPorts: [] }]), fakePorts());
    const plan = await planner.plan({ catalogId: 'pihole' });
    expect(plan.name).toBe('pihole-2');
    expect(plan.hostPort).toBe(8083);
  });

  it('refuses a fixed port bound on the host with PORT_IN_USE naming it', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts({ '53/udp': 'in-use' }));
    await expect(planner.plan({ catalogId: 'pihole' })).rejects.toMatchObject({
      code: 'PORT_IN_USE',
      details: { port: 53, protocol: 'udp' },
    });
  });

  it('refuses a fixed port already used by another EasyHost app', async () => {
    await prisma.app.create({
      data: {
        name: 'other-dns', image: 'x:1', hostPort: 9000, containerPort: 80, status: 'RUNNING',
        fixedPorts: JSON.stringify([{ containerPort: 53, hostPort: 53, protocol: 'udp' }]),
      },
    });
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts());
    await expect(planner.plan({ catalogId: 'pihole' })).rejects.toMatchObject({ code: 'PORT_IN_USE' });
  });

  it('proceeds when a fixed port status is unknown (non-root below 1024)', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts({ '53/tcp': 'unknown', '53/udp': 'unknown' }));
    await expect(planner.plan({ catalogId: 'pihole' })).resolves.toHaveProperty('name', 'pihole');
  });

  it('rejects an unknown catalog id', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([]), fakePorts());
    await expect(planner.plan({ catalogId: 'nope' })).rejects.toMatchObject({ code: 'CATALOG_APP_NOT_FOUND' });
  });

  it('refuses a chosen host port that is bound on the host', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([pihole]), fakePorts({ '9999/tcp': 'in-use' }));
    await expect(planner.plan({ catalogId: 'pihole', hostPort: 9999 })).rejects.toMatchObject({
      code: 'PORT_IN_USE',
      details: { port: 9999, protocol: 'tcp' },
    });
  });

  it('passes an advanced request through, defaulting containerPort to hostPort', async () => {
    const planner = new InstallPlanner(prisma, new Catalog([]), fakePorts());
    await expect(
      planner.plan({ name: 'custom', image: 'nginx:1.27', hostPort: 8088, env: { A: 'b' } }),
    ).resolves.toEqual({ name: 'custom', image: 'nginx:1.27', hostPort: 8088, containerPort: 8088, env: { A: 'b' }, volumes: [] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/apps/install-planner.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the planner** — `src/apps/install-planner.ts`:

```ts
import { randomInt } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { Catalog, FixedPort, Volume } from '../catalog/catalog';
import { CatalogAppNotFoundError, PortInUseError } from '../errors';
import type { IPortChecker } from '../ports/port-checker';
import type { CreateAppInput } from './app.types';

export const APP_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;
export const APP_NAME_MESSAGE =
  'Use letters, numbers, dots, dashes or underscores, starting with a letter or number (no spaces).';

export type InstallRequest =
  | { catalogId: string; name?: string; hostPort?: number }
  | { name: string; image: string; hostPort: number; containerPort?: number; env?: Record<string, string>; volumes?: Volume[] };

export interface IInstallPlanner {
  plan(request: InstallRequest): Promise<CreateAppInput>;
}

const SECRET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomSecret(length = 20): string {
  return Array.from({ length }, () => SECRET_ALPHABET[randomInt(SECRET_ALPHABET.length)]).join('');
}

export class InstallPlanner implements IInstallPlanner {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly catalog: Catalog,
    private readonly ports: IPortChecker,
  ) {}

  async plan(request: InstallRequest): Promise<CreateAppInput> {
    if (!('catalogId' in request)) {
      await this.assertHostPortFree(request.hostPort);
      return {
        name: request.name,
        image: request.image,
        hostPort: request.hostPort,
        containerPort: request.containerPort ?? request.hostPort,
        env: request.env,
        volumes: request.volumes ?? [],
      };
    }

    const entry = this.catalog.get(request.catalogId);
    if (!entry) throw new CatalogAppNotFoundError(request.catalogId);

    const apps = await this.prisma.app.findMany({ select: { name: true, hostPort: true, fixedPorts: true } });
    const usedFixed = apps.flatMap((a) => JSON.parse(a.fixedPorts) as FixedPort[]);
    for (const fixed of entry.fixedPorts) {
      const clash = usedFixed.some((u) => u.hostPort === fixed.hostPort && u.protocol === fixed.protocol);
      if (clash || (await this.ports.check(fixed.hostPort, fixed.protocol)) === 'in-use') {
        throw new PortInUseError(fixed.hostPort, fixed.protocol);
      }
    }

    let hostPort = request.hostPort;
    if (hostPort === undefined) {
      const used = new Set([...apps.map((a) => a.hostPort), ...usedFixed.map((u) => u.hostPort)]);
      hostPort = await this.ports.suggest(entry.defaultHostPort, used);
    } else {
      await this.assertHostPortFree(hostPort);
    }

    const names = new Set(apps.map((a) => a.name));
    let name = request.name ?? entry.id;
    for (let n = 2; request.name === undefined && names.has(name); n++) name = `${entry.id}-${n}`;

    const secrets = Object.fromEntries(entry.generatedSecrets.map((s) => [s.name, randomSecret()]));
    const secretEnv = Object.fromEntries(entry.generatedSecrets.map((s) => [s.env, secrets[s.name]]));

    return {
      name,
      image: entry.image,
      hostPort,
      containerPort: entry.containerPort,
      env: { ...entry.env, ...secretEnv },
      catalogId: entry.id,
      volumes: entry.volumes,
      fixedPorts: entry.fixedPorts,
      secrets,
    };
  }

  private async assertHostPortFree(port: number): Promise<void> {
    if ((await this.ports.check(port, 'tcp')) === 'in-use') {
      throw new PortInUseError(port, 'tcp');
    }
  }
}
```

A chosen name that collides with an existing app still reaches `AppService.create`, which answers `NAME_TAKEN` as in Step 1.

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/apps/install-planner.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the views** — `src/apps/app.view.ts`:

```ts
import * as path from 'path';
import type { App } from '@prisma/client';
import type { Catalog, FixedPort, Volume } from '../catalog/catalog';
import type { AppDataStore } from './app-data';

export interface ViewContext {
  catalog: Catalog;
  dataStore: AppDataStore;
}

export interface AppView {
  id: string;
  name: string;
  image: string;
  status: string;
  hostPort: number;
  containerPort: number;
  catalogId: string | null;
  lastError: string | null;
  openPath: string;
  fixedPorts: FixedPort[];
  dataPath: string;
  volumes: Array<Volume & { hostPath: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppDetailView extends AppView {
  secrets: Array<{ name: string; label: string; value: string }>;
}

export function toAppView(app: App, { catalog, dataStore }: ViewContext): AppView {
  const entry = app.catalogId ? catalog.get(app.catalogId) : undefined;
  const dataPath = dataStore.appDir(app.id);
  const volumes = JSON.parse(app.volumes) as Volume[];
  return {
    id: app.id,
    name: app.name,
    image: app.image,
    status: app.status,
    hostPort: app.hostPort,
    containerPort: app.containerPort,
    catalogId: app.catalogId,
    lastError: app.lastError,
    openPath: entry?.openPath ?? '/',
    fixedPorts: JSON.parse(app.fixedPorts) as FixedPort[],
    dataPath,
    volumes: volumes.map((v) => ({ ...v, hostPath: path.join(dataPath, v.name) })),
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}

export function toAppDetailView(app: App, ctx: ViewContext): AppDetailView {
  const entry = app.catalogId ? ctx.catalog.get(app.catalogId) : undefined;
  const values = JSON.parse(app.secrets) as Record<string, string>;
  const secrets = Object.entries(values).map(([name, value]) => ({
    name,
    value,
    label: entry?.generatedSecrets.find((s) => s.name === name)?.label ?? name,
  }));
  return { ...toAppView(app, ctx), secrets };
}
```

Test helper `test/helpers/views.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Catalog } from '../../src/catalog/catalog';
import { AppDataStore } from '../../src/apps/app-data';
import type { ViewContext } from '../../src/apps/app.view';

export function makeViewContext(catalog = new Catalog([])): ViewContext {
  return { catalog, dataStore: new AppDataStore(fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost-views-'))) };
}
```

- [ ] **Step 6: Write the failing router tests** — rewrite `src/http/server.test.ts`'s `makeApp` so rows carry the new columns (`catalogId: null, volumes: '[]', fixedPorts: '[]', secrets: '{}', lastError: null`, and a cuid-like `id: 'app1'`), build servers with `planner` (a `{ plan: jest.fn() }` mock) and `views: makeViewContext()`, and add:

```ts
  describe('POST /api/apps', () => {
    it('plans a catalog install and answers 202 with the pending app', async () => {
      const { app, appService, planner } = build();
      planner.plan.mockResolvedValue({ name: 'jellyfin', image: 'jellyfin/jellyfin:10.10.7', hostPort: 8096, containerPort: 8096 });
      appService.create.mockResolvedValue(makeApp({ status: 'PENDING', name: 'jellyfin' }) as never);
      const res = await request(app).post('/api/apps').set('Cookie', AUTH_COOKIE).send({ catalogId: 'jellyfin' });
      expect(res.status).toBe(202);
      expect(planner.plan).toHaveBeenCalledWith({ catalogId: 'jellyfin' });
      expect(res.body).toMatchObject({ name: 'jellyfin', status: 'PENDING' });
      expect(res.body).not.toHaveProperty('containerId');
      expect(res.body).not.toHaveProperty('secrets');
    });

    it('refuses a name with spaces with a friendly message', async () => {
      const { app, planner } = build();
      const res = await request(app).post('/api/apps').set('Cookie', AUTH_COOKIE)
        .send({ name: 'My Movies', image: 'nginx:1.27', hostPort: 8088 });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('no spaces');
      expect(planner.plan).not.toHaveBeenCalled();
    });

    it('refuses unknown fields in a catalog request', async () => {
      const { app } = build();
      const res = await request(app).post('/api/apps').set('Cookie', AUTH_COOKIE)
        .send({ catalogId: 'jellyfin', image: 'evil:1' });
      expect(res.status).toBe(400);
    });
  });

  describe('secrets and container ids', () => {
    it('lists apps without secrets or container ids', async () => {
      const { app, appService } = build();
      appService.list.mockResolvedValue([makeApp({ secrets: JSON.stringify({ adminPassword: 's3cret' }) })] as never);
      const res = await request(app).get('/api/apps').set('Cookie', AUTH_COOKIE);
      expect(JSON.stringify(res.body)).not.toContain('s3cret');
      expect(res.body[0]).not.toHaveProperty('containerId');
      expect(res.body[0]).not.toHaveProperty('secrets');
    });

    it('returns secrets on the single-app route', async () => {
      const { app, appService } = build();
      appService.get.mockResolvedValue(makeApp({ secrets: JSON.stringify({ adminPassword: 's3cret' }) }) as never);
      const res = await request(app).get('/api/apps/app1').set('Cookie', AUTH_COOKIE);
      expect(res.body.secrets).toEqual([{ name: 'adminPassword', label: 'adminPassword', value: 's3cret' }]);
    });
  });

  describe('DELETE /api/apps/:id', () => {
    it('keeps data by default and reports where it is', async () => {
      const { app, appService } = build();
      appService.remove.mockResolvedValue({ dataPath: '/data/apps/app1', dataDeleted: false });
      const res = await request(app).delete('/api/apps/app1').set('Cookie', AUTH_COOKIE);
      expect(res.status).toBe(200);
      expect(appService.remove).toHaveBeenCalledWith('app1', { deleteData: false });
      expect(res.body).toEqual({ dataPath: '/data/apps/app1', dataDeleted: false });
    });

    it('deletes data with ?deleteData=true', async () => {
      const { app, appService } = build();
      appService.remove.mockResolvedValue({ dataPath: '/data/apps/app1', dataDeleted: true });
      await request(app).delete('/api/apps/app1?deleteData=true').set('Cookie', AUTH_COOKIE);
      expect(appService.remove).toHaveBeenCalledWith('app1', { deleteData: true });
    });
  });
```

`build()` is a local helper in `server.test.ts` returning `{ app, appService, planner, dockerService }`; replace the file's repeated `createServer({...})` calls with it.

- [ ] **Step 7: Run to verify failure**

Run: `npx jest src/http`
Expected: FAIL — `planner` is not part of `ServerDeps`; POST still answers 201.

- [ ] **Step 8: Implement the router** — replace `src/http/apps.router.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { ValidationError } from '../errors';
import type { IAppService } from '../apps/app.service';
import { APP_NAME_MESSAGE, APP_NAME_PATTERN, type IInstallPlanner } from '../apps/install-planner';
import { toAppDetailView, toAppView, type ViewContext } from '../apps/app.view';
import { volumeSchema } from '../catalog/catalog.schema';

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DEFAULT_TAIL = 200;

const portSchema = z.number().int().positive().max(65535);
const nameSchema = z.string().regex(APP_NAME_PATTERN, APP_NAME_MESSAGE);
const envSchema = z.record(z.string(), z.string()).refine(
  (env) => Object.keys(env).every((key) => ENV_KEY_PATTERN.test(key)),
  { message: 'Environment variable names must match /^[A-Za-z_][A-Za-z0-9_]*$/' },
);

const catalogInstallSchema = z
  .object({ catalogId: z.string().min(1), name: nameSchema.optional(), hostPort: portSchema.optional() })
  .strict();

const advancedInstallSchema = z
  .object({
    name: nameSchema,
    image: z.string().min(1, 'image is required'),
    hostPort: portSchema,
    containerPort: portSchema.optional(),
    env: envSchema.optional(),
    volumes: z.array(volumeSchema).optional(),
  })
  .strict();

const tailQuerySchema = z.coerce.number().int().positive().optional();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join('; '));
  }
  return parsed.data;
}

export interface AppsRouterDeps {
  appService: IAppService;
  planner: IInstallPlanner;
  views: ViewContext;
}

export function createAppsRouter({ appService, planner, views }: AppsRouterDeps): Router {
  const router = Router();

  router.get('/', asyncHandler(async (_req, res) => {
    res.json((await appService.list()).map((app) => toAppView(app, views)));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    res.json(toAppDetailView(await appService.get(req.params.id), views));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const request =
      body && typeof body === 'object' && 'catalogId' in body
        ? parse(catalogInstallSchema, body)
        : parse(advancedInstallSchema, body);
    const app = await appService.create(await planner.plan(request));
    // Secrets are only returned by GET /api/apps/:id (spec).
    res.status(202).json(toAppView(app, views));
  }));

  router.post('/:id/start', asyncHandler(async (req, res) => {
    res.json(toAppView(await appService.start(req.params.id), views));
  }));

  router.post('/:id/stop', asyncHandler(async (req, res) => {
    res.json(toAppView(await appService.stop(req.params.id), views));
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    res.json(await appService.remove(req.params.id, { deleteData: req.query.deleteData === 'true' }));
  }));

  router.get('/:id/logs', asyncHandler(async (req, res) => {
    const parsedTail = tailQuerySchema.safeParse(req.query.tail);
    if (!parsedTail.success) {
      throw new ValidationError('tail must be a positive integer');
    }
    const logs = await appService.logs(req.params.id, { tail: parsedTail.data ?? DEFAULT_TAIL });
    res.type('text/plain').send(logs);
  }));

  return router;
}
```

In `src/http/server.ts` add `planner: IInstallPlanner` and `views: ViewContext` to `ServerDeps` and mount with `createAppsRouter({ appService: deps.appService, planner: deps.planner, views: deps.views })`. Update the `build()` helper in `src/http/auth.router.test.ts` to pass `planner: { plan: jest.fn() }` and `views: makeViewContext()`. In `src/index.ts` build `const catalog = loadCatalog(path.resolve(__dirname, '..', 'catalog'))`, `const dataStore = new AppDataStore(config.dataDir)`, `const planner = new InstallPlanner(prisma, catalog, new PortChecker(config.containerBindAddress))`, and pass `planner` and `views: { catalog, dataStore }`.

- [ ] **Step 9: Run to verify pass**

Run: `npx jest && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src test/helpers/views.ts
git commit -m "feat: install catalog apps through a planner, hide secrets from lists"
```

---

### Task 15: System, catalog and port routes; serving the web interface

**Files:**
- Create: `src/http/system.router.ts`
- Create: `src/http/system.router.test.ts`
- Modify: `src/http/server.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: Task 7 `Catalog`; Task 9 `SystemInfo`; Task 10 `IPortChecker`; Task 14 `ViewContext`.
- Produces:
  - `GET /api/system` → `SystemInfo`
  - `GET /api/catalog` → `Array<CatalogEntry & { iconUrl: string }>` where `iconUrl = '/catalog-icons/<file>.svg'`
  - `GET /api/ports/suggest?preferred=<n>` → `{ port: number }` (skips ports of existing apps)
  - static `/catalog-icons/*` (public), SPA from `webDistDir` with `index.html` fallback for non-`/api`, non-`/health` GETs
  - `ServerDeps` gains `system: () => SystemInfo`, `ports: IPortChecker`, `usedPorts: () => Promise<Set<number>>`, `catalogDir: string`, `webDistDir?: string`
  - `createSystemRouter(deps: { system: () => SystemInfo; catalog: Catalog; ports: IPortChecker; usedPorts: () => Promise<Set<number>> }): Router`

- [ ] **Step 1: Write the failing tests** — `src/http/system.router.test.ts`:

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import request from 'supertest';
import { createServer, type ServerDeps } from './server';
import { Catalog, type CatalogEntry } from '../catalog/catalog';
import { AUTH_COOKIE, makeAuthServiceMock } from '../../test/helpers/auth';
import { makeViewContext } from '../../test/helpers/views';

const entry = {
  id: 'demo', name: 'Demo', description: 'Demo app.', category: 'Media', icon: 'icons/demo.svg',
  image: 'demo/demo:1.0.0', containerPort: 80, defaultHostPort: 8080, env: {}, volumes: [], fixedPorts: [],
  generatedSecrets: [], guide: { afterInstall: [{ text: 'Open it.' }] },
} as CatalogEntry;

function build(overrides: Partial<ServerDeps> = {}) {
  const catalogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost-cat-'));
  fs.mkdirSync(path.join(catalogDir, 'icons'));
  fs.writeFileSync(path.join(catalogDir, 'icons', 'demo.svg'), '<svg/>');
  const ports = { check: jest.fn(), suggest: jest.fn().mockResolvedValue(8081) };
  const deps: ServerDeps = {
    appService: {} as ServerDeps['appService'],
    dockerService: { ping: jest.fn().mockResolvedValue(true) } as unknown as ServerDeps['dockerService'],
    authService: makeAuthServiceMock(),
    planner: { plan: jest.fn() },
    views: makeViewContext(new Catalog([entry])),
    system: () => ({ os: 'linux', distros: ['ubuntu', 'debian'], version: '0.2.0' }),
    ports,
    usedPorts: async () => new Set([8080]),
    catalogDir,
    ...overrides,
  };
  return { app: createServer(deps), ports };
}

describe('system routes', () => {
  it('GET /api/system reports the server OS and version', async () => {
    const res = await request(build().app).get('/api/system').set('Cookie', AUTH_COOKIE);
    expect(res.body).toEqual({ os: 'linux', distros: ['ubuntu', 'debian'], version: '0.2.0' });
  });

  it('GET /api/catalog adds icon URLs', async () => {
    const res = await request(build().app).get('/api/catalog').set('Cookie', AUTH_COOKIE);
    expect(res.body[0]).toMatchObject({ id: 'demo', iconUrl: '/catalog-icons/demo.svg' });
  });

  it('serves catalog icons without a session', async () => {
    const res = await request(build().app).get('/catalog-icons/demo.svg');
    expect(res.status).toBe(200);
  });

  it('GET /api/ports/suggest skips ports used by apps', async () => {
    const { app, ports } = build();
    const res = await request(app).get('/api/ports/suggest?preferred=8080').set('Cookie', AUTH_COOKIE);
    expect(res.body).toEqual({ port: 8081 });
    expect(ports.suggest).toHaveBeenCalledWith(8080, new Set([8080]));
  });

  it('rejects a non-numeric preferred port', async () => {
    const res = await request(build().app).get('/api/ports/suggest?preferred=abc').set('Cookie', AUTH_COOKIE);
    expect(res.status).toBe(400);
  });
});

describe('web interface', () => {
  function withWebDist() {
    const webDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easyhost-web-'));
    fs.writeFileSync(path.join(webDistDir, 'index.html'), '<!doctype html><title>EasyHost</title>');
    return build({ webDistDir }).app;
  }

  it('serves index.html for app routes like /apps/123', async () => {
    const res = await request(withWebDist()).get('/apps/123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<title>EasyHost</title>');
  });

  it('does not serve index.html for unknown /api routes', async () => {
    const res = await request(withWebDist()).get('/api/nope');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/http/system.router.test.ts`
Expected: FAIL — cannot find `system` in `ServerDeps`.

- [ ] **Step 3: Implement** — `src/http/system.router.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './async-handler';
import { ValidationError } from '../errors';
import type { Catalog } from '../catalog/catalog';
import type { IPortChecker } from '../ports/port-checker';
import type { SystemInfo } from '../system/system';

export interface SystemRouterDeps {
  system: () => SystemInfo;
  catalog: Catalog;
  ports: IPortChecker;
  usedPorts: () => Promise<Set<number>>;
}

const preferredSchema = z.coerce.number().int().min(1).max(65535);

export function createSystemRouter({ system, catalog, ports, usedPorts }: SystemRouterDeps): Router {
  const router = Router();

  router.get('/system', (_req, res) => {
    res.json(system());
  });

  router.get('/catalog', (_req, res) => {
    // entry.icon is "icons/<id>.svg", served under /catalog-icons/.
    res.json(catalog.entries.map((entry) => ({ ...entry, iconUrl: `/catalog-${entry.icon}` })));
  });

  router.get('/ports/suggest', asyncHandler(async (req, res) => {
    const preferred = preferredSchema.safeParse(req.query.preferred);
    if (!preferred.success) {
      throw new ValidationError('preferred must be a port number');
    }
    res.json({ port: await ports.suggest(preferred.data, await usedPorts()) });
  }));

  return router;
}
```

In `src/http/server.ts` add the deps listed under **Interfaces**, and before `app.use(errorMiddleware)`:

```ts
  app.use('/catalog-icons', express.static(path.join(deps.catalogDir, 'icons')));
  app.use('/api', createSystemRouter({
    system: deps.system,
    catalog: deps.views.catalog,
    ports: deps.ports,
    usedPorts: deps.usedPorts,
  }));

  if (deps.webDistDir && fs.existsSync(path.join(deps.webDistDir, 'index.html'))) {
    const indexHtml = path.join(deps.webDistDir, 'index.html');
    app.use(express.static(deps.webDistDir));
    app.get(/^(?!\/api\/|\/api$|\/health$|\/catalog-icons\/).*/, (_req, res) => res.sendFile(indexHtml));
  }
```

Place the `/catalog-icons` static mount before the `/api` middleware lines so it stays public. Import `fs`, `path` and `createSystemRouter`. Update the other test files' `build()` helpers to pass `system`, `ports`, `usedPorts` and `catalogDir` (a temp dir with an `icons` folder).

Replace `src/index.ts` `main` with an async version:

```ts
async function main(): Promise<void> {
  const config = loadConfig();
  // ... existing docker/prisma/dockerService construction ...
  const catalogDir = path.resolve(__dirname, '..', 'catalog');
  const catalog = loadCatalog(catalogDir);
  const dataStore = new AppDataStore(config.dataDir);
  const ports = new PortChecker(config.containerBindAddress);
  const appService = new AppService(prisma, dockerService, dataStore);
  const recovered = await appService.recoverInterruptedInstalls();
  if (recovered > 0) console.log(`Marked ${recovered} interrupted installation(s) as failed.`);

  const usedPorts = async () => {
    const apps = await prisma.app.findMany({ select: { hostPort: true } });
    return new Set(apps.map((a) => a.hostPort));
  };
  const app = createServer({
    appService,
    dockerService,
    authService: new AuthService(prisma),
    planner: new InstallPlanner(prisma, catalog, ports),
    views: { catalog, dataStore },
    system: () => detectSystem(),
    ports,
    usedPorts,
    catalogDir,
    webDistDir: path.resolve(__dirname, '..', 'web', 'dist'),
    secureCookies: config.trustProxy,
    trustProxy: config.trustProxy,
  });

  app.listen(config.port, config.host, () => {
    console.log(`EasyHost is running at http://${config.host === '0.0.0.0' ? '<server-IP>' : config.host}:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Keep the existing bind-address log line. `path.resolve(__dirname, '..', 'catalog')` and `'..', 'web', 'dist'` resolve to the repo root both from `src/` (ts-node) and from `dist/` (built).

- [ ] **Step 4: Run to verify pass**

Run: `npx jest && npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "feat: add system, catalog and port routes and serve the web interface"
```

---

## Phase B — Web interface

All frontend commands run from the repository root. Frontend tests use Vitest with jsdom and a mocked `fetch`; they never start the backend.

### Task 16: Web scaffold, API client and error messages

**Files:**
- Modify: `package.json` (dependencies and scripts), `jest.config.js`, `eslint.config.mjs`, `.gitignore`
- Create: `web/index.html`, `web/vite.config.ts`, `web/tsconfig.json`
- Create: `web/src/main.tsx`, `web/src/App.tsx` (temporary shell, replaced in Task 17), `web/src/styles.css`
- Create: `web/src/api/client.ts`, `web/src/api/messages.ts`, `web/src/api/types.ts`
- Create: `web/src/test/setup.ts`, `web/src/test/fetch-mock.ts`
- Create: `web/src/api/client.test.ts`, `web/src/api/messages.test.ts`

**Interfaces:**
- Consumes: Task 5 `ERROR_CODES`, `ErrorCode` from `src/errors.ts`.
- Produces:
  - `class ApiError extends Error { code: string; status: number; details: Record<string, unknown> }`
  - `api<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>` — JSON in/out, text for `text/plain`, `undefined` for 204; network failure → `ApiError('NETWORK', ..., 0)`
  - `setUnauthenticatedHandler(fn: () => void): void` — called on any 401 `UNAUTHENTICATED`
  - `messageFor(err: unknown): string`, `formatWait(seconds: number): string` (`0:30`, `2:00`, `15:00`)
  - types in `web/src/api/types.ts`: `AuthStatus`, `AppStatus`, `AppView`, `AppDetailView`, `GuideStep`, `Guide`, `CatalogEntry`, `SystemInfo`, `RemoveResult`
  - test helper `mockApi(handlers: ApiHandler[]): { calls: ApiCall[]; handlers: ApiHandler[] }` where `ApiHandler = { method: string; path: string | RegExp; status?: number; body?: unknown }` (the last matching handler wins, so tests can push a new handler to change a response) and `ApiCall = { method: string; path: string; body: unknown }`

- [ ] **Step 1: Install frontend dependencies**

Run:

```bash
npm install -D react@18 react-dom@18 react-router-dom@6 @types/react@18 @types/react-dom@18 vite@5 @vitejs/plugin-react@4 vitest@2 jsdom@25 @testing-library/react@16 @testing-library/user-event@14 @testing-library/jest-dom@6 eslint-plugin-react-hooks@5 globals@15
```

Expected: all added under `devDependencies` (the UI ships as static files, so none are runtime dependencies of the server).

- [ ] **Step 2: Scripts and tool config**

`package.json` scripts (replace the existing `build`, `test`, `typecheck`, keep the others):

```json
    "build": "tsc -p tsconfig.build.json && vite build --config web/vite.config.ts",
    "dev:web": "vite --config web/vite.config.ts",
    "test": "jest && vitest run --config web/vite.config.ts",
    "test:web": "vitest run --config web/vite.config.ts",
    "typecheck": "tsc --noEmit && tsc --noEmit -p web/tsconfig.json",
```

`jest.config.js` — keep Jest out of `web/`:

```js
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/test/**/*.test.ts'],
```

`.gitignore` — add `web/dist`.

`eslint.config.mjs` — add `web/dist/**` to `ignores`, import `reactHooks from 'eslint-plugin-react-hooks'` and `globals from 'globals'`, and append:

```js
  {
    files: ['web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
```

`web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "../src/errors.ts"]
}
```

`web/vite.config.ts`:

```ts
/// <reference types="vitest" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = 'http://localhost:3000';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
  server: { proxy: { '/api': backend, '/health': backend, '/catalog-icons': backend } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'src/test/setup.ts')],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>EasyHost</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
```

`web/src/App.tsx` (temporary, replaced in Task 17):

```tsx
export function App() {
  return <h1>EasyHost</h1>;
}
```

`web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
```

`web/src/test/fetch-mock.ts`:

```ts
export interface ApiHandler {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
}

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

export function mockApi(handlers: ApiHandler[]) {
  const calls: ApiCall[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    let handler: ApiHandler | undefined;
    for (let i = handlers.length - 1; i >= 0; i--) {
      const h = handlers[i];
      if (h.method === method && (typeof h.path === 'string' ? h.path === path : h.path.test(path))) {
        handler = h;
        break;
      }
    }
    const status = handler?.status ?? (handler ? 200 : 404);
    const body = handler ? handler.body : { error: { code: 'APP_NOT_FOUND', message: `unmocked ${method} ${path}` } };
    if (status === 204) return new Response(null, { status });
    const isText = typeof body === 'string';
    return new Response(isText ? body : JSON.stringify(body ?? {}), {
      status,
      headers: { 'Content-Type': isText ? 'text/plain' : 'application/json' },
    });
  }));
  return { calls, handlers };
}
```

- [ ] **Step 3: Write the failing tests** — `web/src/api/client.test.ts`:

```ts
import { ApiError, api, setUnauthenticatedHandler } from './client';
import { mockApi } from '../test/fetch-mock';

describe('api', () => {
  it('sends JSON with the content type on POST and parses JSON back', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/api/apps', status: 202, body: { id: 'a1' } }]);
    await expect(api('POST', '/api/apps', { catalogId: 'jellyfin' })).resolves.toEqual({ id: 'a1' });
    expect(calls[0]).toEqual({ method: 'POST', path: '/api/apps', body: { catalogId: 'jellyfin' } });
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends {} for POSTs without a body', async () => {
    const { calls } = mockApi([{ method: 'POST', path: '/api/apps/a1/start', body: {} }]);
    await api('POST', '/api/apps/a1/start');
    expect(calls[0].body).toEqual({});
  });

  it('returns text for text/plain and undefined for 204', async () => {
    mockApi([
      { method: 'GET', path: '/api/apps/a1/logs?tail=200', body: 'line 1\nline 2' },
      { method: 'POST', path: '/api/auth/logout', status: 204 },
    ]);
    await expect(api('GET', '/api/apps/a1/logs?tail=200')).resolves.toBe('line 1\nline 2');
    await expect(api('POST', '/api/auth/logout')).resolves.toBeUndefined();
  });

  it('throws ApiError with code, status and extra details', async () => {
    mockApi([{ method: 'POST', path: '/api/auth/login', status: 429, body: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'x', retryAfterSeconds: 30 } } }]);
    await expect(api('POST', '/api/auth/login', { password: 'p' })).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
      status: 429,
      details: { retryAfterSeconds: 30 },
    });
  });

  it('calls the unauthenticated handler on 401 UNAUTHENTICATED', async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    mockApi([{ method: 'GET', path: '/api/apps', status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } }]);
    await expect(api('GET', '/api/apps')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalled();
  });

  it('turns a network failure into a NETWORK error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('GET', '/api/apps')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });
});
```

`web/src/api/messages.test.ts`:

```ts
import { ERROR_CODES } from '../../../src/errors';
import { ApiError } from './client';
import { ERROR_MESSAGES, formatWait, messageFor } from './messages';

describe('messages', () => {
  it.each(ERROR_CODES)('has a plain-English message for %s', (code) => {
    expect(ERROR_MESSAGES[code]).toBeDefined();
  });

  it('formats waits as m:ss', () => {
    expect(formatWait(30)).toBe('0:30');
    expect(formatWait(120)).toBe('2:00');
    expect(formatWait(900)).toBe('15:00');
  });

  it('uses details in messages', () => {
    expect(messageFor(new ApiError('PORT_IN_USE', 'x', 409, { port: 53, protocol: 'udp' }))).toContain('Port 53');
    expect(messageFor(new ApiError('TOO_MANY_ATTEMPTS', 'x', 429, { retryAfterSeconds: 90 }))).toContain('1:30');
  });

  it('shows our own validation text as is', () => {
    expect(messageFor(new ApiError('VALIDATION_FAILED', 'Use letters (no spaces).', 400))).toBe('Use letters (no spaces).');
  });

  it('never shows raw text for unknown errors', () => {
    expect(messageFor(new Error('ECONNRESET at socket.js:12'))).toBe(ERROR_MESSAGES.INTERNAL_ERROR(new ApiError('INTERNAL_ERROR', '', 500)));
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npm run test:web`
Expected: FAIL — cannot find `./client`.

- [ ] **Step 5: Implement** — `web/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let onUnauthenticated: () => void = () => {};

export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('NETWORK', "Can't reach EasyHost", 0);
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('Content-Type')?.includes('application/json');
  const data: unknown = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const { code = 'INTERNAL_ERROR', message = '', ...details } =
      (data as { error?: Record<string, unknown> } | undefined)?.error ?? {};
    if (res.status === 401 && code === 'UNAUTHENTICATED') onUnauthenticated();
    throw new ApiError(String(code), String(message), res.status, details);
  }
  return data as T;
}
```

`web/src/api/messages.ts`:

```ts
import type { ErrorCode } from '../../../src/errors';
import { ApiError } from './client';

type Message = (err: ApiError) => string;

export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const fixed = (text: string): Message => () => text;

export const ERROR_MESSAGES: Record<ErrorCode | 'NETWORK' | 'INTERNAL_ERROR', Message> = {
  VALIDATION_FAILED: (e) => e.message || 'Some details are not valid.',
  APP_NOT_FOUND: fixed("This app doesn't exist anymore. It may have been removed."),
  NAME_TAKEN: fixed('Another app already uses this name. Pick a different one.'),
  PORT_TAKEN: fixed('Another app already uses this port. Pick a different one in Advanced.'),
  DOCKER_UNAVAILABLE: fixed("Docker isn't running on the server, so apps can't start."),
  DOCKER_OPERATION_FAILED: fixed("The server couldn't complete this action. Try again in a moment."),
  CONTAINER_MISSING: fixed("This app was removed from the server outside EasyHost. Remove it here and install it again."),
  UNAUTHENTICATED: fixed('Please log in again.'),
  INVALID_CREDENTIALS: fixed('Wrong password.'),
  INVALID_RECOVERY_CODE: fixed("This recovery code isn't valid. Check it and try again."),
  TOO_MANY_ATTEMPTS: (e) => `Too many attempts. Try again in ${formatWait(Number(e.details.retryAfterSeconds ?? 0))}.`,
  SETUP_ALREADY_DONE: fixed('EasyHost is already set up. Log in instead.'),
  CATALOG_APP_NOT_FOUND: fixed('This app is no longer in the catalog.'),
  PORT_IN_USE: (e) =>
    `Port ${String(e.details.port)} is already used by another program on the server. Pick another port in Advanced, or see the app's guide.`,
  JSON_REQUIRED: fixed('Something went wrong sending the request. Reload the page and try again.'),
  NETWORK: fixed("Can't reach EasyHost. Check that the server is on."),
  INTERNAL_ERROR: fixed('Something went wrong on the server. Try again in a moment.'),
};

export function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    const message = ERROR_MESSAGES[err.code as keyof typeof ERROR_MESSAGES] ?? ERROR_MESSAGES.INTERNAL_ERROR;
    return message(err);
  }
  return ERROR_MESSAGES.INTERNAL_ERROR(new ApiError('INTERNAL_ERROR', '', 500));
}
```

`web/src/api/types.ts`:

```ts
export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
}

export type AppStatus = 'PENDING' | 'RUNNING' | 'STOPPED' | 'ERROR';

export interface AppView {
  id: string;
  name: string;
  image: string;
  status: AppStatus;
  hostPort: number;
  containerPort: number;
  catalogId: string | null;
  lastError: string | null;
  openPath: string;
  fixedPorts: Array<{ containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }>;
  dataPath: string;
  volumes: Array<{ name: string; containerPath: string; hostPath: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface AppDetailView extends AppView {
  secrets: Array<{ name: string; label: string; value: string }>;
}

export interface GuideStep {
  text: string;
  command?: string;
}

export type DeviceOs = 'router' | 'windows' | 'macos' | 'linux' | 'android' | 'ios';

export interface Guide {
  afterInstall: GuideStep[];
  server?: {
    linux?: { default: GuideStep[]; [distro: string]: GuideStep[] };
    windows?: GuideStep[];
    macos?: GuideStep[];
  };
  devices?: Partial<Record<DeviceOs, GuideStep[]>>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  category: 'Media' | 'Files' | 'Smart home' | 'Network' | 'Monitoring';
  iconUrl: string;
  defaultHostPort: number;
  openPath?: string;
  guide: Guide;
}

export interface SystemInfo {
  os: 'linux' | 'windows' | 'macos' | 'other';
  distros: string[];
  version: string;
}

export interface RemoveResult {
  dataPath: string;
  dataDeleted: boolean;
}
```

`web/src/styles.css`:

```css
:root {
  --bg: #f6f7f9;
  --surface: #ffffff;
  --text: #1c2330;
  --muted: #5b6474;
  --border: #dde1e7;
  --accent: #2f6fdf;
  --accent-text: #ffffff;
  --ok: #1f8a4c;
  --warn: #b26a00;
  --danger: #c0392b;
  --radius: 12px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--text);
  background: var(--bg);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #11151c;
    --surface: #1a2029;
    --text: #e6e9ee;
    --muted: #9aa3b2;
    --border: #2c3440;
    --accent: #6c9cf5;
    --accent-text: #0b1020;
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); }
a { color: var(--accent); }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
button, .button {
  font: inherit; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); padding: 0.5rem 0.9rem; cursor: pointer; text-decoration: none;
}
button.primary, .button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
button.danger { color: var(--danger); }
button:disabled { opacity: 0.55; cursor: not-allowed; }
input, select { font: inherit; padding: 0.5rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); color: var(--text); width: 100%; }
label { display: block; margin: 0.75rem 0 0.25rem; font-weight: 600; }
.hint { color: var(--muted); font-size: 0.9rem; margin: 0.25rem 0; }
.error { color: var(--danger); margin: 0.5rem 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1rem; }
.notice { background: var(--surface); border-left: 4px solid var(--warn); padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; }
.banner { background: var(--warn); color: #fff; padding: 0.6rem 1rem; }
.center-page { max-width: 420px; margin: 8vh auto; padding: 0 1rem; }
.code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 1.3rem; letter-spacing: 0.08em; padding: 1rem; text-align: center; }
pre { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }

.layout { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 1rem; display: flex; flex-direction: column; gap: 0.25rem; }
.sidebar .brand { font-weight: 700; margin-bottom: 1rem; }
.sidebar a { padding: 0.6rem 0.75rem; border-radius: 8px; color: var(--text); text-decoration: none; }
.sidebar a.active { background: var(--bg); font-weight: 600; }
.content { padding: 1.5rem; max-width: 1100px; width: 100%; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; }
.app-card { display: flex; flex-direction: column; gap: 0.5rem; cursor: pointer; }
.app-card .row { display: flex; align-items: center; gap: 0.75rem; }
.icon { width: 44px; height: 44px; border-radius: 10px; flex: none; }
.actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.badge { font-size: 0.8rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: var(--bg); }
.badge.RUNNING { color: var(--ok); } .badge.ERROR { color: var(--danger); } .badge.PENDING { color: var(--warn); }
.tabs { display: flex; flex-wrap: wrap; gap: 0.25rem; margin: 0.5rem 0; }
.tabs button[aria-selected='true'] { background: var(--accent); color: var(--accent-text); }
dialog { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); color: var(--text); max-width: 520px; width: calc(100% - 2rem); }

@media (max-width: 700px) {
  .layout { grid-template-columns: 1fr; padding-bottom: 64px; }
  .sidebar { position: fixed; bottom: 0; left: 0; right: 0; flex-direction: row; justify-content: space-around; border-right: none; border-top: 1px solid var(--border); padding: 0.5rem; z-index: 10; }
  .sidebar .brand { display: none; }
  .content { padding: 1rem; }
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm run test:web && npm run typecheck && npm run lint && npx jest`
Expected: PASS (Jest no longer picks up `web/`).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json jest.config.js eslint.config.mjs .gitignore web
git commit -m "feat: scaffold the web interface with an API client and error messages"
```

---

### Task 17: First run, login, recovery and the auth gate

**Files:**
- Create: `web/src/auth.tsx`
- Modify: `web/src/App.tsx`
- Create: `web/src/components/CopyButton.tsx`
- Create: `web/src/pages/SetupPage.tsx`, `web/src/pages/RecoveryCodePage.tsx`, `web/src/pages/LoginPage.tsx`, `web/src/pages/RecoverPage.tsx`
- Create: `web/src/pages/HomePage.tsx` (placeholder `<h1>Home</h1>`, replaced in Task 18)
- Create: `web/src/test/render.tsx`
- Create: `web/src/pages/auth-flow.test.tsx`

**Interfaces:**
- Consumes: Task 16 `api`, `setUnauthenticatedHandler`, `messageFor`, `formatWait`, `AuthStatus`.
- Produces:
  - `AuthProvider`, `useAuth(): { status: AuthStatus | null; refresh(): Promise<void>; markLoggedOut(): void }`
  - routes: `/setup`, `/recovery-code` (reads `location.state: { code: string; next: string }`), `/login` (reads `?next=`), `/recover`, and the authenticated area (`/`, `/apps/:id`, `/add`, `/settings`)
  - `CopyButton({ text, label? })` — uses `navigator.clipboard` when available, else a hidden textarea + `document.execCommand('copy')` (plain HTTP on the LAN has no clipboard API)
  - `renderApp(path: string)` test helper: renders `<AuthProvider><App/></AuthProvider>` in a `MemoryRouter` at `path`, returns `{ user }` from `userEvent.setup()`

- [ ] **Step 1: Write the test helper** — `web/src/test/render.tsx`:

```tsx
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AuthProvider } from '../auth';

export function renderApp(path = '/') {
  // Only advance fake timers when a test enabled them; with real timers this is a no-op.
  const user = userEvent.setup({ advanceTimers: (ms) => (vi.isFakeTimers() ? vi.advanceTimersByTime(ms) : undefined) });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { user };
}
```

- [ ] **Step 2: Write the failing tests** — `web/src/pages/auth-flow.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

const loggedOut = { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: false } };
const loggedIn = { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } };

describe('first run', () => {
  it('creates the password, shows the recovery code with a strong recommendation, and continues without a checkbox', async () => {
    const api = mockApi([
      { method: 'GET', path: '/api/auth/status', body: { setupRequired: true, authenticated: false } },
      { method: 'POST', path: '/api/auth/setup', status: 201, body: { recoveryCode: 'K7QX2-ABCDE-FGHJK-MNPQR' } },
    ]);
    const { user } = renderApp('/');

    expect(await screen.findByRole('heading', { name: /welcome to easyhost/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^password$/i), 'long enough pw');
    await user.type(screen.getByLabelText(/confirm password/i), 'long enough pw');
    api.handlers.push(loggedIn);
    await user.click(screen.getByRole('button', { name: /create password/i }));

    expect(await screen.findByText('K7QX2-ABCDE-FGHJK-MNPQR')).toBeInTheDocument();
    expect(screen.getByText(/strongly recommend/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const cont = screen.getByRole('button', { name: /continue/i });
    expect(cont).toBeEnabled();
    await user.click(cont);
    expect(await screen.findByRole('heading', { name: /home/i })).toBeInTheDocument();
  });

  it('checks the passwords match and are long enough before sending', async () => {
    const api = mockApi([{ method: 'GET', path: '/api/auth/status', body: { setupRequired: true, authenticated: false } }]);
    const { user } = renderApp('/');
    await screen.findByRole('heading', { name: /welcome/i });
    await user.type(screen.getByLabelText(/^password$/i), 'short');
    await user.type(screen.getByLabelText(/confirm password/i), 'short');
    await user.click(screen.getByRole('button', { name: /create password/i }));
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/auth/setup')).toBe(false);
  });
});

describe('login', () => {
  it('sends a deep link to login and returns there afterwards', async () => {
    const api = mockApi([loggedOut, { method: 'POST', path: '/api/auth/login', status: 204 }]);
    const { user } = renderApp('/settings');
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/password/i), 'long enough pw');
    api.handlers.push(loggedIn, { method: 'GET', path: '/api/system', body: { os: 'linux', distros: [], version: '0.2.0' } });
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByRole('heading', { name: /settings/i })).toBeInTheDocument();
  });

  it('shows "Wrong password." for a wrong password', async () => {
    mockApi([loggedOut, { method: 'POST', path: '/api/auth/login', status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } } }]);
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText(/password/i), 'nope nope nope');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    expect(await screen.findByText('Wrong password.')).toBeInTheDocument();
  });

  it('counts down after too many attempts and re-enables the button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi([loggedOut, { method: 'POST', path: '/api/auth/login', status: 429, body: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'x', retryAfterSeconds: 3 } } }]);
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText(/password/i), 'nope nope nope');
    await user.click(screen.getByRole('button', { name: /log in/i }));
    const button = await screen.findByRole('button', { name: /try again in 0:03/i });
    expect(button).toBeDisabled();
    await vi.advanceTimersByTimeAsync(3100);
    expect(screen.getByRole('button', { name: /^log in$/i })).toBeEnabled();
  });
});

describe('forgot password', () => {
  it('resets the password with the recovery code and shows the new code', async () => {
    const api = mockApi([loggedOut, { method: 'POST', path: '/api/auth/recover', body: { recoveryCode: 'NEWCO-DENEW-CODEN-EWCOD' } }]);
    const { user } = renderApp('/login');
    await user.click(await screen.findByRole('link', { name: /forgot password/i }));
    await user.type(screen.getByLabelText(/recovery code/i), 'k7qx2 abcde fghjk mnpqr');
    await user.type(screen.getByLabelText(/^new password$/i), 'recovered password');
    await user.type(screen.getByLabelText(/confirm new password/i), 'recovered password');
    api.handlers.push(loggedIn);
    await user.click(screen.getByRole('button', { name: /reset password/i }));
    expect(await screen.findByText('NEWCO-DENEW-CODEN-EWCOD')).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/auth/recover')?.body).toEqual({
      recoveryCode: 'k7qx2 abcde fghjk mnpqr',
      newPassword: 'recovered password',
    });
  });

  it('shows the invalid-code message', async () => {
    mockApi([loggedOut, { method: 'POST', path: '/api/auth/recover', status: 401, body: { error: { code: 'INVALID_RECOVERY_CODE', message: 'x' } } }]);
    const { user } = renderApp('/recover');
    await user.type(await screen.findByLabelText(/recovery code/i), 'AAAAA');
    await user.type(screen.getByLabelText(/^new password$/i), 'recovered password');
    await user.type(screen.getByLabelText(/confirm new password/i), 'recovered password');
    await user.click(screen.getByRole('button', { name: /reset password/i }));
    expect(await screen.findByText(/isn't valid/i)).toBeInTheDocument();
  });
});
```

The login deep-link test lands on Settings, which Task 21 builds; until then add a placeholder `SettingsPage` returning `<h1>Settings</h1>` in this task (Task 21 replaces it).

- [ ] **Step 3: Run to verify failure**

Run: `npm run test:web`
Expected: FAIL — cannot find `../auth`.

- [ ] **Step 4: Implement** — `web/src/auth.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setUnauthenticatedHandler } from './api/client';
import type { AuthStatus } from './api/types';

interface AuthContextValue {
  status: AuthStatus | null;
  refresh(): Promise<void>;
  markLoggedOut(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const refresh = useCallback(async () => {
    setStatus(await api<AuthStatus>('GET', '/api/auth/status'));
  }, []);
  const markLoggedOut = useCallback(() => {
    setStatus((s) => (s ? { ...s, authenticated: false } : s));
  }, []);

  useEffect(() => {
    setUnauthenticatedHandler(markLoggedOut);
    refresh().catch(() => setStatus({ setupRequired: false, authenticated: false }));
  }, [refresh, markLoggedOut]);

  return <AuthContext.Provider value={{ status, refresh, markLoggedOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
```

`web/src/App.tsx`:

```tsx
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { SetupPage } from './pages/SetupPage';
import { RecoveryCodePage } from './pages/RecoveryCodePage';
import { LoginPage } from './pages/LoginPage';
import { RecoverPage } from './pages/RecoverPage';
import { HomePage } from './pages/HomePage';
import { SettingsPage } from './pages/SettingsPage';

export function App() {
  const { status } = useAuth();
  const location = useLocation();

  if (!status) return <p className="center-page">Loading…</p>;

  if (status.setupRequired) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!status.authenticated) {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="*" element={<Navigate to={`/login?next=${next}`} replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/recovery-code" element={<RecoveryCodePage />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={<HomePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

Task 18 wraps the authenticated routes in `Layout` and adds `/apps/:id` and `/add`.

`web/src/components/CopyButton.tsx`:

```tsx
import { useState } from 'react';

function fallbackCopy(text: string): void {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else fallbackCopy(text);
    } catch {
      fallbackCopy(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" onClick={copy}>
      {copied ? 'Copied' : label}
    </button>
  );
}
```

`web/src/pages/SetupPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { useAuth } from '../auth';

export const MIN_PASSWORD_LENGTH = 10;

export function strengthHint(password: string): string {
  if (password.length === 0) return '';
  if (password.length < MIN_PASSWORD_LENGTH) return `Too short: use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length < 14) return 'Good. A few more characters make it stronger.';
  return 'Strong.';
}

export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

export function SetupPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const { recoveryCode } = await api<{ recoveryCode: string }>('POST', '/api/auth/setup', { password });
      await refresh();
      navigate('/recovery-code', { replace: true, state: { code: recoveryCode, next: '/' } });
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <main className="center-page">
      <h1>Welcome to EasyHost</h1>
      <p className="hint">Create the password you'll use to manage your apps.</p>
      <form className="card" onSubmit={submit}>
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="hint">{strengthHint(password)}</p>
        <label htmlFor="confirm">Confirm password</label>
        <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <p><button className="primary" type="submit" disabled={busy}>Create password</button></p>
      </form>
    </main>
  );
}
```

`web/src/pages/RecoveryCodePage.tsx`:

```tsx
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { CopyButton } from '../components/CopyButton';

export function RecoveryCodePage() {
  const navigate = useNavigate();
  const state = useLocation().state as { code?: string; next?: string } | null;
  if (!state?.code) return <Navigate to="/" replace />;
  const { code, next = '/' } = state;

  const download = () => {
    const blob = new Blob([`EasyHost recovery code\n\n${code}\n\nUse it on the "Forgot password?" page if you lose your password.\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'easyhost-recovery-code.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="center-page">
      <h1>Your recovery code</h1>
      <div className="card">
        <p className="code">{code}</p>
        <div className="actions">
          <CopyButton text={code} />
          <button type="button" onClick={download}>Download</button>
        </div>
      </div>
      <p className="notice">
        We strongly recommend saving this code somewhere safe, like a password manager or a printed page. It is the
        only way to get back into EasyHost if you forget your password, and it won't be shown again.
      </p>
      <button className="primary" type="button" onClick={() => navigate(next, { replace: true })}>Continue</button>
    </main>
  );
}
```

`web/src/pages/LoginPage.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { formatWait, messageFor } from '../api/messages';
import { useAuth } from '../auth';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';

  useEffect(() => {
    if (waitSeconds <= 0) return;
    const timer = setTimeout(() => setWaitSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [waitSeconds]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/auth/login', { password });
      await refresh();
      navigate(next.startsWith('/') ? next : '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'TOO_MANY_ATTEMPTS') {
        setWaitSeconds(Number(err.details.retryAfterSeconds ?? 30));
      }
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const waiting = waitSeconds > 0;
  return (
    <main className="center-page">
      <h1>Log in</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && !waiting && <p className="error" role="alert">{error}</p>}
        <p>
          <button className="primary" type="submit" disabled={busy || waiting}>
            {waiting ? `Try again in ${formatWait(waitSeconds)}` : 'Log in'}
          </button>
        </p>
        <Link to="/recover">Forgot password?</Link>
      </form>
    </main>
  );
}
```

`next.startsWith('/')` prevents an open redirect through `?next=https://...`; also reject `//` by using `next.startsWith('/') && !next.startsWith('//')`.

`web/src/pages/RecoverPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { useAuth } from '../auth';
import { passwordProblem } from './SetupPage';

export function RecoverPage() {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const { recoveryCode } = await api<{ recoveryCode: string }>('POST', '/api/auth/recover', {
        recoveryCode: code,
        newPassword: password,
      });
      await refresh();
      navigate('/recovery-code', { replace: true, state: { code: recoveryCode, next: '/' } });
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <main className="center-page">
      <h1>Reset your password</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="code">Recovery code</label>
        <input id="code" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <p className="hint">The code you saved when you set up EasyHost. Dashes and capitals don't matter.</p>
        <label htmlFor="new">New password</label>
        <input id="new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor="confirm">Confirm new password</label>
        <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error" role="alert">{error}</p>}
        <p><button className="primary" type="submit" disabled={busy}>Reset password</button></p>
        <Link to="/login">Back to log in</Link>
      </form>
    </main>
  );
}
```

Placeholders for this task: `web/src/pages/HomePage.tsx` → `export function HomePage() { return <h1>Home</h1>; }` and `web/src/pages/SettingsPage.tsx` → `export function SettingsPage() { return <h1>Settings</h1>; }`.

Update `web/src/main.tsx` to wrap `<App />` in `<AuthProvider>`.

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add first-run, login and password recovery screens"
```

---

### Task 18: Layout and the Home screen

**Files:**
- Create: `web/src/components/Layout.tsx`, `web/src/components/AppCard.tsx`, `web/src/components/StatusBadge.tsx`, `web/src/components/AppIcon.tsx`
- Create: `web/src/lib/address.ts`, `web/src/lib/use-polling.ts`, `web/src/lib/catalog.ts`
- Modify: `web/src/pages/HomePage.tsx`, `web/src/App.tsx`
- Create: `web/src/lib/address.test.ts`, `web/src/pages/HomePage.test.tsx`

**Interfaces:**
- Consumes: Task 16 `api`, types; Task 17 `CopyButton`, `renderApp`.
- Produces:
  - `appAddress(app: { hostPort: number; openPath: string }, location?: { hostname: string }): string` — always `http://`, uses the hostname the browser used
  - `serverAddress(location?: { hostname: string }): string` — hostname without IPv6 brackets
  - `usePolling<T>(load: () => Promise<T>, intervalMs: number): { data: T | undefined; error: unknown; reload(): Promise<void> }` — loads immediately, then every interval while the tab is visible
  - `useCatalog(): CatalogEntry[] | undefined` (loaded once per page)
  - `STATUS_LABELS: Record<AppStatus, string>` = Running, Stopped, Installing…, Problem
  - `Layout` renders the sidebar (`nav` with links Home, Add, Settings) and an `<Outlet/>`; Task 21 adds banners inside it
  - `AppIcon({ iconUrl?, name })` — catalog icon or a letter tile
  - Home suggestions: catalog ids `jellyfin`, `nextcloud`, `home-assistant`, `pihole`, linking to `/add?install=<id>`

- [ ] **Step 1: Write the failing tests** — `web/src/lib/address.test.ts`:

```ts
import { appAddress, serverAddress } from './address';

describe('address helpers', () => {
  it('uses the hostname the browser used, the app port and its open path', () => {
    expect(appAddress({ hostPort: 8096, openPath: '/' }, { hostname: '192.168.1.50' })).toBe('http://192.168.1.50:8096');
    expect(appAddress({ hostPort: 8082, openPath: '/admin' }, { hostname: '192.168.1.50' })).toBe('http://192.168.1.50:8082/admin');
  });

  it('keeps IPv6 brackets in URLs and strips them for display', () => {
    expect(appAddress({ hostPort: 80, openPath: '/' }, { hostname: '[fd00::5]' })).toBe('http://[fd00::5]:80');
    expect(serverAddress({ hostname: '[fd00::5]' })).toBe('fd00::5');
  });
});
```

`web/src/pages/HomePage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

const loggedIn = { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } };
const health = { method: 'GET', path: '/health', body: { ok: true, docker: true } };
const catalog = {
  method: 'GET',
  path: '/api/catalog',
  body: ['jellyfin', 'nextcloud', 'home-assistant', 'pihole', 'uptime-kuma'].map((id) => ({
    id, name: id, description: `${id} app`, category: 'Media', iconUrl: `/catalog-icons/${id}.svg`, defaultHostPort: 8000, guide: { afterInstall: [] },
  })),
};

function app(overrides: Record<string, unknown>) {
  return {
    id: 'a1', name: 'jellyfin', image: 'jellyfin/jellyfin:10.10.7', status: 'RUNNING', hostPort: 8096, containerPort: 8096,
    catalogId: 'jellyfin', lastError: null, openPath: '/', fixedPorts: [], dataPath: '/data/apps/a1', volumes: [],
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...overrides,
  };
}

describe('Home', () => {
  it('shows the empty state with four suggestions', async () => {
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [] }]);
    renderApp('/');
    expect(await screen.findByText(/you don't have any apps yet/i)).toBeInTheDocument();
    const suggestions = screen.getAllByRole('link', { name: /install/i });
    expect(suggestions.map((a) => a.getAttribute('href'))).toEqual([
      '/add?install=jellyfin', '/add?install=nextcloud', '/add?install=home-assistant', '/add?install=pihole',
    ]);
  });

  it('shows each app with a plain status and its address', async () => {
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [
      app({}),
      app({ id: 'a2', name: 'pihole', catalogId: 'pihole', status: 'ERROR', hostPort: 8082, openPath: '/admin' }),
    ] }]);
    renderApp('/');
    const jellyfin = (await screen.findByText('jellyfin')).closest('.app-card') as HTMLElement;
    expect(within(jellyfin).getByText('Running')).toBeInTheDocument();
    expect(within(jellyfin).getByRole('link', { name: /open/i })).toHaveAttribute('href', 'http://localhost:8096');
    const pihole = screen.getByText('pihole').closest('.app-card') as HTMLElement;
    expect(within(pihole).getByText('Problem')).toBeInTheDocument();
    expect(within(pihole).getByRole('link', { name: /open/i })).toHaveAttribute('href', 'http://localhost:8082/admin');
  });

  it('refreshes every 5 seconds so an installing app turns into running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [app({ status: 'PENDING' })] }]);
    renderApp('/');
    expect(await screen.findByText('Installing…')).toBeInTheDocument();
    api.handlers.push({ method: 'GET', path: '/api/apps', body: [app({ status: 'RUNNING' })] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await screen.findByText('Running')).toBeInTheDocument();
  });

  it('copies the address without the clipboard API (plain HTTP)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true);
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [app({})] }]);
    const { user } = renderApp('/');
    await user.click(await screen.findByRole('button', { name: /copy/i }));
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('has Home, Add and Settings in the navigation', async () => {
    mockApi([loggedIn, health, catalog, { method: 'GET', path: '/api/apps', body: [] }]);
    renderApp('/');
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'Add', 'Settings']);
  });
});
```

The jsdom test URL is `http://localhost:3000`, hence the `localhost` addresses. Update the Task 17 first-run test to wait for the empty state text instead of the `Home` placeholder heading (the Home page keeps an `<h1>Home</h1>`, so it still passes).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:web`
Expected: FAIL — cannot find `./address`.

- [ ] **Step 3: Implement the helpers** — `web/src/lib/address.ts`:

```ts
export function appAddress(app: { hostPort: number; openPath: string }, location: { hostname: string } = window.location): string {
  const path = app.openPath && app.openPath !== '/' ? app.openPath : '';
  return `http://${location.hostname}:${app.hostPort}${path}`;
}

export function serverAddress(location: { hostname: string } = window.location): string {
  return location.hostname.replace(/^\[|\]$/g, '');
}
```

`web/src/lib/use-polling.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export function usePolling<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(undefined);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void reload();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs]);

  return { data, error, reload };
}
```

`web/src/lib/catalog.ts`:

```ts
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CatalogEntry } from '../api/types';

export function useCatalog(): CatalogEntry[] | undefined {
  const [entries, setEntries] = useState<CatalogEntry[]>();
  useEffect(() => {
    api<CatalogEntry[]>('GET', '/api/catalog').then(setEntries).catch(() => setEntries([]));
  }, []);
  return entries;
}
```

- [ ] **Step 4: Implement the components** — `web/src/components/StatusBadge.tsx`:

```tsx
import type { AppStatus } from '../api/types';

export const STATUS_LABELS: Record<AppStatus, string> = {
  RUNNING: 'Running',
  STOPPED: 'Stopped',
  PENDING: 'Installing…',
  ERROR: 'Problem',
};

export function StatusBadge({ status }: { status: AppStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>;
}
```

`web/src/components/AppIcon.tsx`:

```tsx
export function AppIcon({ iconUrl, name }: { iconUrl?: string; name: string }) {
  if (iconUrl) return <img className="icon" src={iconUrl} alt="" />;
  return (
    <svg className="icon" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#6b7280" />
      <text x="32" y="42" textAnchor="middle" fontSize="30" fontWeight="700" fill="#fff">{name.charAt(0).toUpperCase()}</text>
    </svg>
  );
}
```

`web/src/components/AppCard.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import type { AppView } from '../api/types';
import { appAddress } from '../lib/address';
import { AppIcon } from './AppIcon';
import { CopyButton } from './CopyButton';
import { StatusBadge } from './StatusBadge';

export function AppCard({ app, iconUrl }: { app: AppView; iconUrl?: string }) {
  const navigate = useNavigate();
  const address = appAddress(app);
  return (
    <div className="card app-card" onClick={() => navigate(`/apps/${app.id}`)}>
      <div className="row">
        <AppIcon iconUrl={iconUrl} name={app.name} />
        <div>
          <strong>{app.name}</strong>
          <div><StatusBadge status={app.status} /></div>
        </div>
      </div>
      <span className="hint">{address}</span>
      <div className="actions">
        <a className="button" href={address} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open</a>
        <CopyButton text={address} />
      </div>
    </div>
  );
}
```

`web/src/components/Layout.tsx`:

```tsx
import { NavLink, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="layout">
      <nav className="sidebar" aria-label="Main">
        <span className="brand">EasyHost</span>
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/add">Add</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
```

The `brand` span is not a link, so the navigation's links are exactly Home, Add, Settings.

`web/src/pages/HomePage.tsx`:

```tsx
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import type { AppView } from '../api/types';
import { AppCard } from '../components/AppCard';
import { AppIcon } from '../components/AppIcon';
import { useCatalog } from '../lib/catalog';
import { usePolling } from '../lib/use-polling';

const SUGGESTED = ['jellyfin', 'nextcloud', 'home-assistant', 'pihole'];

export function HomePage() {
  const { data: apps, error } = usePolling(() => api<AppView[]>('GET', '/api/apps'), 5000);
  const catalog = useCatalog();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const iconOf = (catalogId: string | null) => catalog?.find((c) => c.id === catalogId)?.iconUrl;

  return (
    <>
      <h1>Home</h1>
      {notice && <p className="notice" role="status">{notice}</p>}
      {error !== undefined && !apps && <p className="error" role="alert">{messageFor(error)}</p>}
      {apps && apps.length === 0 && (
        <section>
          <p><strong>You don't have any apps yet.</strong> Pick one to get started, or browse everything in Add.</p>
          <div className="grid">
            {SUGGESTED.map((id) => catalog?.find((c) => c.id === id)).filter(Boolean).map((entry) => (
              <div key={entry!.id} className="card">
                <div className="row app-card">
                  <AppIcon iconUrl={entry!.iconUrl} name={entry!.name} />
                  <strong>{entry!.name}</strong>
                </div>
                <p className="hint">{entry!.description}</p>
                <Link className="button primary" to={`/add?install=${entry!.id}`} aria-label={`Install ${entry!.name}`}>Install</Link>
              </div>
            ))}
          </div>
          <p><Link to="/add">Browse all apps</Link></p>
        </section>
      )}
      {apps && apps.length > 0 && (
        <div className="grid">
          {apps.map((app) => <AppCard key={app.id} app={app} iconUrl={iconOf(app.catalogId)} />)}
        </div>
      )}
    </>
  );
}
```

Update `web/src/App.tsx`'s authenticated routes:

```tsx
    <Routes>
      <Route path="/recovery-code" element={<RecoveryCodePage />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add the layout and the Home screen"
```

---

### Task 19: App page with guide, secrets, logs and removal

**Files:**
- Create: `web/src/lib/guide.ts`, `web/src/lib/guide.test.ts`
- Create: `web/src/components/GuideView.tsx`, `web/src/components/GuideView.test.tsx`
- Create: `web/src/components/LogViewer.tsx`, `web/src/components/RemoveDialog.tsx`
- Create: `web/src/pages/AppDetailPage.tsx`, `web/src/pages/AppDetailPage.test.tsx`
- Modify: `web/src/App.tsx` (route `/apps/:id`)

**Interfaces:**
- Consumes: Task 16 types and `api`; Task 18 `usePolling`, `useCatalog`, `appAddress`, `serverAddress`, `StatusBadge`, `AppIcon`, `CopyButton`.
- Produces:
  - `pickServerSteps(server: Guide['server'], system: SystemInfo): { key: string; label: string; steps: GuideStep[] } | null`
  - `serverVariants(server: Guide['server']): Array<{ key: string; label: string; steps: GuideStep[] }>`
  - `deviceOsFromUserAgent(userAgent: string): Exclude<DeviceOs, 'router'> | null`
  - `DEVICE_LABELS: Record<DeviceOs, string>` (`router` → "Router (recommended)")
  - `fillPlaceholders(text: string, serverAddress: string): string`
  - `GuideView({ guide, system, part?: 'all' | 'server' })` — `part="server"` renders only the "On the server" section (used by the install dialog in Task 20)
  - `useSystem(): SystemInfo | undefined` in `web/src/lib/guide.ts`

- [ ] **Step 1: Write the failing tests** — `web/src/lib/guide.test.ts`:

```ts
import { deviceOsFromUserAgent, fillPlaceholders, pickServerSteps, serverVariants } from './guide';

const server = {
  linux: { default: [{ text: 'default' }], ubuntu: [{ text: 'ubuntu' }], fedora: [{ text: 'fedora' }] },
  windows: [{ text: 'windows' }],
  macos: [{ text: 'macos' }],
};

describe('pickServerSteps', () => {
  it.each([
    [{ os: 'linux', distros: ['ubuntu', 'debian'] }, 'ubuntu'],
    [{ os: 'linux', distros: ['linuxmint', 'ubuntu', 'debian'] }, 'ubuntu'],
    [{ os: 'linux', distros: ['debian'] }, 'default'],
    [{ os: 'linux', distros: [] }, 'default'],
    [{ os: 'windows', distros: [] }, 'windows'],
    [{ os: 'macos', distros: [] }, 'macos'],
  ] as const)('%j → %s', (system, text) => {
    expect(pickServerSteps(server, { ...system, distros: [...system.distros], version: '1' })!.steps[0].text).toBe(text);
  });

  it('returns null when the app has no server steps', () => {
    expect(pickServerSteps(undefined, { os: 'linux', distros: [], version: '1' })).toBeNull();
  });

  it('lists every variant with a readable label', () => {
    expect(serverVariants(server).map((v) => v.label)).toEqual(['Linux', 'Ubuntu', 'Fedora', 'Windows', 'macOS']);
  });
});

describe('deviceOsFromUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'ios'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['curl/8.0', null],
  ])('%s → %s', (ua, os) => {
    expect(deviceOsFromUserAgent(ua)).toBe(os);
  });
});

it('fills {serverAddress}', () => {
  expect(fillPlaceholders('Set DNS to {serverAddress}.', '192.168.1.50')).toBe('Set DNS to 192.168.1.50.');
});
```

`web/src/components/GuideView.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuideView } from './GuideView';

const guide = {
  afterInstall: [{ text: 'Open it.' }],
  server: {
    linux: { default: [{ text: 'Nothing to do.' }], ubuntu: [{ text: 'Turn off the stub:', command: 'sudo sed -i x' }] },
    windows: [{ text: 'Windows server step.' }],
  },
  devices: {
    router: [{ text: 'Set the router DNS to {serverAddress}.' }],
    windows: [{ text: 'Windows device step.' }],
    ios: [{ text: 'iPhone step with {serverAddress}.' }],
  },
};

describe('GuideView', () => {
  it('shows the server variant matching the reported system, with copyable commands', () => {
    render(<GuideView guide={guide} system={{ os: 'linux', distros: ['ubuntu', 'debian'], version: '1' }} />);
    expect(screen.getByText(/steps for your server \(ubuntu\)/i)).toBeInTheDocument();
    expect(screen.getByText('sudo sed -i x')).toBeInTheDocument();
    expect(screen.queryByText('Nothing to do.')).not.toBeInTheDocument();
  });

  it('preselects the viewer\'s device and lets them switch, filling in the server address', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    render(<GuideView guide={guide} system={{ os: 'linux', distros: [], version: '1' }} />);
    expect(screen.getByRole('tab', { name: 'Windows' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Windows device step.')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Router (recommended)', 'Windows', 'iPhone / iPad']);
    await userEvent.click(screen.getByRole('tab', { name: 'iPhone / iPad' }));
    expect(screen.getByText('iPhone step with localhost.')).toBeInTheDocument();
  });

  it('shows only the server part in server mode', () => {
    render(<GuideView guide={guide} system={{ os: 'windows', distros: [], version: '1' }} part="server" />);
    expect(screen.getByText('Windows server step.')).toBeInTheDocument();
    expect(screen.queryByText('Open it.')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});
```

`web/src/pages/AppDetailPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

const base = [
  { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } },
  { method: 'GET', path: '/health', body: { ok: true, docker: true } },
  { method: 'GET', path: '/api/system', body: { os: 'linux', distros: ['ubuntu'], version: '0.2.0' } },
  { method: 'GET', path: '/api/catalog', body: [{ id: 'pihole', name: 'Pi-hole', description: 'd', category: 'Network', iconUrl: '/catalog-icons/pihole.svg', defaultHostPort: 8082, openPath: '/admin', guide: { afterInstall: [{ text: 'Log in with the Admin password.' }] } }] },
  { method: 'GET', path: /\/api\/apps\/a1\/logs\?tail=200/, body: 'pihole started' },
];

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1', name: 'pihole', image: 'pihole/pihole:2025.03.0', status: 'RUNNING', hostPort: 8082, containerPort: 80,
    catalogId: 'pihole', lastError: null, openPath: '/admin', fixedPorts: [], dataPath: '/data/apps/a1',
    volumes: [{ name: 'config', containerPath: '/etc/pihole', hostPath: '/data/apps/a1/config' }],
    secrets: [{ name: 'adminPassword', label: 'Admin password', value: 'S3cretValue12345678x' }],
    createdAt: '2026-01-01', updatedAt: '2026-01-01', ...overrides,
  };
}

describe('App page', () => {
  it('shows the address, the guide, logs and the data folder; the secret is hidden until shown', async () => {
    mockApi([...base, { method: 'GET', path: '/api/apps/a1', body: detail() }]);
    const { user } = renderApp('/apps/a1');
    expect(await screen.findByRole('heading', { name: 'pihole' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute('href', 'http://localhost:8082/admin');
    expect(screen.getByText('Log in with the Admin password.')).toBeInTheDocument();
    expect(await screen.findByText('pihole started')).toBeInTheDocument();
    expect(screen.getByText('/data/apps/a1/config')).toBeInTheDocument();
    expect(screen.queryByText('S3cretValue12345678x')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByText('S3cretValue12345678x')).toBeInTheDocument();
  });

  it('shows the problem message and lets the user try starting again', async () => {
    const api = mockApi([...base,
      { method: 'GET', path: '/api/apps/a1', body: detail({ status: 'ERROR', lastError: 'Port 53 is already used by another program on the server.' }) },
      { method: 'POST', path: '/api/apps/a1/start', body: detail() },
    ]);
    const { user } = renderApp('/apps/a1');
    expect(await screen.findByText(/port 53 is already used/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^start$/i }));
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/api/apps/a1/start')).toBe(true);
  });

  it('removes the app keeping its data by default', async () => {
    const api = mockApi([...base,
      { method: 'GET', path: '/api/apps/a1', body: detail() },
      { method: 'DELETE', path: '/api/apps/a1?deleteData=false', body: { dataPath: '/data/apps/a1', dataDeleted: false } },
      { method: 'GET', path: '/api/apps', body: [] },
    ]);
    const { user } = renderApp('/apps/a1');
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    expect(screen.getByText(/your data stays in \/data\/apps\/a1/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /delete data too/i })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /remove app/i }));
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/api/apps/a1?deleteData=false')).toBe(true);
    expect(await screen.findByText(/you don't have any apps yet/i)).toBeInTheDocument();
  });

  it('deletes data when asked, and warns if the folder could not be deleted', async () => {
    mockApi([...base,
      { method: 'GET', path: '/api/apps/a1', body: detail() },
      { method: 'DELETE', path: '/api/apps/a1?deleteData=true', body: { dataPath: '/data/apps/a1', dataDeleted: false } },
      { method: 'GET', path: '/api/apps', body: [] },
    ]);
    const { user } = renderApp('/apps/a1');
    await user.click(await screen.findByRole('button', { name: /^remove$/i }));
    await user.click(screen.getByRole('checkbox', { name: /delete data too/i }));
    await user.click(screen.getByRole('button', { name: /remove app/i }));
    expect(await screen.findByText(/couldn't be deleted: \/data\/apps\/a1/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:web`
Expected: FAIL — cannot find `./guide`.

- [ ] **Step 3: Implement the guide helpers** — `web/src/lib/guide.ts`:

```ts
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { DeviceOs, Guide, GuideStep, SystemInfo } from '../api/types';

type Variant = { key: string; label: string; steps: GuideStep[] };

const DISTRO_LABELS: Record<string, string> = {
  default: 'Linux', ubuntu: 'Ubuntu', debian: 'Debian', fedora: 'Fedora', arch: 'Arch Linux', raspbian: 'Raspberry Pi OS',
};

export const DEVICE_LABELS: Record<DeviceOs, string> = {
  router: 'Router (recommended)',
  windows: 'Windows',
  macos: 'Mac',
  linux: 'Linux',
  android: 'Android',
  ios: 'iPhone / iPad',
};

export function serverVariants(server: Guide['server']): Variant[] {
  if (!server) return [];
  const linux = Object.entries(server.linux ?? {}).map(([key, steps]) => ({
    key: `linux:${key}`,
    label: DISTRO_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1),
    steps,
  }));
  const others: Variant[] = [];
  if (server.windows) others.push({ key: 'windows', label: 'Windows', steps: server.windows });
  if (server.macos) others.push({ key: 'macos', label: 'macOS', steps: server.macos });
  return [...linux, ...others];
}

export function pickServerSteps(server: Guide['server'], system: SystemInfo): Variant | null {
  const variants = serverVariants(server);
  if (variants.length === 0) return null;
  const find = (key: string) => variants.find((v) => v.key === key);
  if (system.os === 'windows' || system.os === 'macos') return find(system.os) ?? variants[0];
  for (const distro of system.distros) {
    const match = distro !== 'default' ? find(`linux:${distro}`) : undefined;
    if (match) return match;
  }
  return find('linux:default') ?? variants[0];
}

export function deviceOsFromUserAgent(userAgent: string): Exclude<DeviceOs, 'router'> | null {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos';
  if (/Linux|X11/i.test(userAgent)) return 'linux';
  return null;
}

export function fillPlaceholders(text: string, serverAddress: string): string {
  return text.split('{serverAddress}').join(serverAddress);
}

export function useSystem(): SystemInfo | undefined {
  const [system, setSystem] = useState<SystemInfo>();
  useEffect(() => {
    api<SystemInfo>('GET', '/api/system').then(setSystem).catch(() => setSystem({ os: 'other', distros: [], version: '' }));
  }, []);
  return system;
}
```

- [ ] **Step 4: Implement the components** — `web/src/components/GuideView.tsx`:

```tsx
import { useState } from 'react';
import type { DeviceOs, Guide, GuideStep, SystemInfo } from '../api/types';
import { serverAddress } from '../lib/address';
import { DEVICE_LABELS, deviceOsFromUserAgent, fillPlaceholders, pickServerSteps, serverVariants } from '../lib/guide';
import { CopyButton } from './CopyButton';

function Steps({ steps }: { steps: GuideStep[] }) {
  const address = serverAddress();
  return (
    <ol>
      {steps.map((step, i) => (
        <li key={i}>
          <p>{fillPlaceholders(step.text, address)}</p>
          {step.command && (
            <div>
              <pre><code>{step.command}</code></pre>
              <CopyButton text={step.command} label="Copy command" />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

const DEVICE_ORDER: DeviceOs[] = ['router', 'windows', 'macos', 'linux', 'android', 'ios'];

export function GuideView({ guide, system, part = 'all' }: { guide: Guide; system?: SystemInfo; part?: 'all' | 'server' }) {
  const picked = system ? pickServerSteps(guide.server, system) : null;
  const [serverKey, setServerKey] = useState<string | null>(null);
  const variants = serverVariants(guide.server);
  const server = variants.find((v) => v.key === serverKey) ?? picked;

  const devices = DEVICE_ORDER.filter((os) => guide.devices?.[os]);
  const detected = deviceOsFromUserAgent(navigator.userAgent);
  const [device, setDevice] = useState<DeviceOs | undefined>(
    detected && devices.includes(detected) ? detected : devices[0],
  );

  return (
    <section>
      {part === 'all' && (
        <>
          <h2>After installing</h2>
          <Steps steps={guide.afterInstall} />
        </>
      )}
      {server && (
        <>
          <h2>{part === 'server' ? 'Before you install' : 'On the server'}</h2>
          <p className="hint">Steps for your server ({server.label})</p>
          <Steps steps={server.steps} />
          {variants.length > 1 && (
            <details>
              <summary>Show steps for another system</summary>
              <div className="tabs">
                {variants.map((v) => (
                  <button key={v.key} type="button" onClick={() => setServerKey(v.key)}>{v.label}</button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
      {part === 'all' && devices.length > 0 && device && (
        <>
          <h2>On your devices</h2>
          <div className="tabs" role="tablist">
            {devices.map((os) => (
              <button key={os} type="button" role="tab" aria-selected={os === device} onClick={() => setDevice(os)}>
                {DEVICE_LABELS[os]}
              </button>
            ))}
          </div>
          <Steps steps={guide.devices![device]!} />
        </>
      )}
    </section>
  );
}
```

`web/src/components/LogViewer.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { messageFor } from '../api/messages';

export function LogViewer({ appId }: { appId: string }) {
  const [logs, setLogs] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);

  const load = useCallback(async () => {
    try {
      setLogs(await api<string>('GET', `/api/apps/${appId}/logs?tail=200`));
      setError(null);
    } catch (err) {
      setError(messageFor(err));
    }
  }, [appId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [auto, load]);

  return (
    <section>
      <h2>Logs</h2>
      <div className="actions">
        <button type="button" onClick={() => void load()}>Refresh</button>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', margin: 0, fontWeight: 400 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Refresh automatically
        </label>
      </div>
      {error ? <p className="error">{error}</p> : <pre>{logs || 'No log lines yet.'}</pre>}
    </section>
  );
}
```

`web/src/components/RemoveDialog.tsx`:

```tsx
import { useState } from 'react';

export function RemoveDialog({ appName, dataPath, onCancel, onConfirm, busy }: {
  appName: string;
  dataPath: string;
  onCancel(): void;
  onConfirm(deleteData: boolean): void;
  busy: boolean;
}) {
  const [deleteData, setDeleteData] = useState(false);
  return (
    <div className="card" role="dialog" aria-label={`Remove ${appName}`}>
      <p><strong>Remove {appName}?</strong></p>
      <p>The app will stop and be removed. Your data stays in {dataPath}, so installing it again later picks up where you left off.</p>
      <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
        Delete data too
      </label>
      {deleteData && <p className="error">The data folder will be permanently deleted. This can't be undone.</p>}
      <div className="actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="danger" disabled={busy} onClick={() => onConfirm(deleteData)}>Remove app</button>
      </div>
    </div>
  );
}
```

`web/src/pages/AppDetailPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import type { AppDetailView, RemoveResult } from '../api/types';
import { AppIcon } from '../components/AppIcon';
import { CopyButton } from '../components/CopyButton';
import { GuideView } from '../components/GuideView';
import { LogViewer } from '../components/LogViewer';
import { RemoveDialog } from '../components/RemoveDialog';
import { StatusBadge } from '../components/StatusBadge';
import { appAddress } from '../lib/address';
import { useCatalog } from '../lib/catalog';
import { useSystem } from '../lib/guide';
import { usePolling } from '../lib/use-polling';

function Secret({ label, value }: { label: string; value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="actions" style={{ alignItems: 'center' }}>
      <span>{label}:</span>
      <code>{shown ? value : '••••••••••••'}</code>
      <button type="button" onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      <CopyButton text={value} />
    </div>
  );
}

export function AppDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: app, error, reload } = usePolling(() => api<AppDetailView>('GET', `/api/apps/${id}`), 5000);
  const catalog = useCatalog();
  const system = useSystem();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (!app) return error ? <p className="error" role="alert">{messageFor(error)}</p> : <p>Loading…</p>;

  const entry = catalog?.find((c) => c.id === app.catalogId);
  const address = appAddress(app);

  const run = async (action: 'start' | 'stop') => {
    setBusy(true);
    setActionError(null);
    try {
      await api('POST', `/api/apps/${id}/${action}`);
      await reload();
    } catch (err) {
      setActionError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (deleteData: boolean) => {
    setBusy(true);
    try {
      const result = await api<RemoveResult>('DELETE', `/api/apps/${id}?deleteData=${deleteData}`);
      const notice = deleteData && !result.dataDeleted
        ? `${app.name} was removed, but its data folder couldn't be deleted: ${result.dataPath}`
        : `${app.name} was removed.`;
      navigate('/', { state: { notice } });
    } catch (err) {
      setActionError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row app-card" style={{ cursor: 'default' }}>
        <AppIcon iconUrl={entry?.iconUrl} name={app.name} />
        <h1 style={{ margin: 0 }}>{app.name}</h1>
        <StatusBadge status={app.status} />
      </div>

      {app.status === 'ERROR' && app.lastError && <p className="notice" role="alert">{app.lastError}</p>}
      {actionError && <p className="error" role="alert">{actionError}</p>}

      <section className="card">
        <p>{address}</p>
        <div className="actions">
          <a className="button primary" href={address} target="_blank" rel="noreferrer">Open</a>
          <CopyButton text={address} />
          {app.status === 'RUNNING'
            ? <button type="button" disabled={busy} onClick={() => void run('stop')}>Stop</button>
            : <button type="button" disabled={busy || app.status === 'PENDING'} onClick={() => void run('start')}>Start</button>}
          <button type="button" className="danger" onClick={() => setRemoving(true)}>Remove</button>
        </div>
        {app.secrets.map((s) => <Secret key={s.name} label={s.label} value={s.value} />)}
      </section>

      {removing && (
        <RemoveDialog appName={app.name} dataPath={app.dataPath} busy={busy} onCancel={() => setRemoving(false)} onConfirm={(d) => void remove(d)} />
      )}

      {entry && <GuideView guide={entry.guide} system={system} />}

      <LogViewer appId={app.id} />

      <section>
        <h2>Data</h2>
        <p className="hint">This app's files are kept on the server in:</p>
        <ul>{app.volumes.map((v) => <li key={v.name}><code>{v.hostPath}</code></li>)}</ul>
      </section>

      <details>
        <summary>Advanced details</summary>
        <p className="hint">Image {app.image} · port {app.hostPort} → {app.containerPort}</p>
      </details>
    </>
  );
}
```

Add `<Route path="/apps/:id" element={<AppDetailPage />} />` inside the `Layout` route in `web/src/App.tsx`.

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat: add the app page with guides, secrets, logs and removal"
```

---

### Task 20: Add screen — catalog, install dialog and custom images

**Files:**
- Create: `web/src/lib/names.ts`, `web/src/lib/names.test.ts`
- Create: `web/src/components/InstallDialog.tsx`, `web/src/components/CustomImageForm.tsx`
- Create: `web/src/pages/AddPage.tsx`, `web/src/pages/AddPage.test.tsx`
- Modify: `web/src/App.tsx` (route `/add`)

**Interfaces:**
- Consumes: Task 16 `api`, `messageFor`, `ApiError`; Task 18 `useCatalog`, `AppIcon`; Task 19 `GuideView`, `useSystem`.
- Produces:
  - `APP_NAME_PATTERN` (same as the backend's) and `suggestName(input: string): string` — lowercase, spaces and invalid characters → `-`, trimmed, starts with a letter or digit, max 63
  - `nameProblem(name: string): string | null`
  - `volumeNameFor(containerPath: string): string` in `CustomImageForm.tsx` (`/app/data` → `app-data`)
  - `AddPage` reads `?install=<id>` to open that app's dialog directly
  - After a successful install: `navigate('/')`

- [ ] **Step 1: Write the failing tests** — `web/src/lib/names.test.ts`:

```ts
import { nameProblem, suggestName } from './names';

describe('app names', () => {
  it.each([
    ['My Movies', 'my-movies'],
    ['  Jellyfin!! 2 ', 'jellyfin-2'],
    ['-weird--name-', 'weird-name'],
    ['Café', 'caf'],
  ])('suggests %p → %p', (input, expected) => {
    expect(suggestName(input)).toBe(expected);
  });

  it('explains what is wrong with a name with spaces', () => {
    expect(nameProblem('My Movies')).toMatch(/no spaces/);
    expect(nameProblem('my-movies')).toBeNull();
    expect(nameProblem('')).toMatch(/name/i);
  });
});
```

`web/src/pages/AddPage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

function entry(id: string, category: string, extra: Record<string, unknown> = {}) {
  return { id, name: id.replace(/^./, (c) => c.toUpperCase()), description: `${id} description`, category, iconUrl: `/catalog-icons/${id}.svg`, defaultHostPort: 8096, guide: { afterInstall: [{ text: 'Open it.' }] }, ...extra };
}

const base = [
  { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } },
  { method: 'GET', path: '/health', body: { ok: true, docker: true } },
  { method: 'GET', path: '/api/system', body: { os: 'linux', distros: ['ubuntu'], version: '0.2.0' } },
  { method: 'GET', path: '/api/catalog', body: [
    entry('jellyfin', 'Media'),
    entry('nextcloud', 'Files'),
    entry('pihole', 'Network', { guide: { afterInstall: [{ text: 'Open it.' }], server: { linux: { default: [{ text: 'Nothing.' }], ubuntu: [{ text: 'Turn off the Ubuntu DNS helper.' }] } } } }),
  ] },
  { method: 'GET', path: /\/api\/ports\/suggest\?preferred=\d+/, body: { port: 8097 } },
  { method: 'GET', path: '/api/apps', body: [] },
];

describe('Add', () => {
  it('filters by search and by category', async () => {
    mockApi(base);
    const { user } = renderApp('/add');
    await screen.findByText('Jellyfin');
    await user.type(screen.getByRole('searchbox'), 'cloud');
    expect(screen.queryByText('Jellyfin')).not.toBeInTheDocument();
    expect(screen.getByText('Nextcloud')).toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('button', { name: 'Network' }));
    expect(screen.getByText('Pihole')).toBeInTheDocument();
    expect(screen.queryByText('Nextcloud')).not.toBeInTheDocument();
  });

  it('installs with the prefilled name and one click, then goes Home', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/apps', status: 202, body: { id: 'a1' } }]);
    const { user } = renderApp('/add');
    const card = (await screen.findByText('Jellyfin')).closest('.card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /install/i }));
    expect(screen.getByLabelText(/name/i)).toHaveValue('jellyfin');
    await user.click(screen.getByRole('button', { name: /^install jellyfin$/i }));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ catalogId: 'jellyfin', name: 'jellyfin' });
    expect(await screen.findByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });

  it('suggests a valid name when the user types one with spaces', async () => {
    mockApi(base);
    const { user } = renderApp('/add?install=jellyfin');
    const name = await screen.findByLabelText(/name/i);
    await user.clear(name);
    await user.type(name, 'My Movies');
    expect(screen.getByText(/no spaces/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^install jellyfin$/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /use my-movies/i }));
    expect(name).toHaveValue('my-movies');
    expect(screen.getByRole('button', { name: /^install jellyfin$/i })).toBeEnabled();
  });

  it('sends the port only when changed in Advanced', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/apps', status: 202, body: { id: 'a1' } }]);
    const { user } = renderApp('/add?install=jellyfin');
    await user.click(await screen.findByText(/advanced/i));
    const port = screen.getByLabelText(/port/i);
    expect(port).toHaveValue(8097);
    await user.clear(port);
    await user.type(port, '9000');
    await user.click(screen.getByRole('button', { name: /^install jellyfin$/i }));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ catalogId: 'jellyfin', name: 'jellyfin', hostPort: 9000 });
  });

  it('opens Pi-hole with "Before you install" steps for the server and shows port errors plainly', async () => {
    mockApi([...base, { method: 'POST', path: '/api/apps', status: 409, body: { error: { code: 'PORT_IN_USE', message: 'x', port: 53, protocol: 'udp' } } }]);
    const { user } = renderApp('/add?install=pihole');
    expect(await screen.findByText(/before you install/i)).toBeInTheDocument();
    expect(screen.getByText('Turn off the Ubuntu DNS helper.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^install pihole$/i }));
    expect(await screen.findByText(/port 53 is already used/i)).toBeInTheDocument();
  });

  it('installs a custom image through the advanced form', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/apps', status: 202, body: { id: 'a9' } }]);
    const { user } = renderApp('/add');
    await user.click(await screen.findByRole('button', { name: /install a custom image/i }));
    await user.type(screen.getByLabelText(/^app name$/i), 'whoami');
    await user.type(screen.getByLabelText(/^image$/i), 'traefik/whoami:v1.10');
    await user.clear(screen.getByLabelText(/port on the server/i));
    await user.type(screen.getByLabelText(/port on the server/i), '8095');
    await user.type(screen.getByLabelText(/port inside the app/i), '80');
    await user.click(screen.getByRole('button', { name: /add setting/i }));
    await user.type(screen.getByLabelText(/setting 1 name/i), 'TZ');
    await user.type(screen.getByLabelText(/setting 1 value/i), 'Europe/Rome');
    await user.click(screen.getByRole('button', { name: /add folder/i }));
    await user.type(screen.getByLabelText(/folder 1/i), '/app/data');
    await user.click(screen.getByRole('button', { name: /^install$/i }));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      name: 'whoami',
      image: 'traefik/whoami:v1.10',
      hostPort: 8095,
      containerPort: 80,
      env: { TZ: 'Europe/Rome' },
      volumes: [{ name: 'app-data', containerPath: '/app/data' }],
    });
  });

  it('explains a folder path that does not start with /', async () => {
    const api = mockApi(base);
    const { user } = renderApp('/add');
    await user.click(await screen.findByRole('button', { name: /install a custom image/i }));
    await user.type(screen.getByLabelText(/^app name$/i), 'whoami');
    await user.type(screen.getByLabelText(/^image$/i), 'traefik/whoami:v1.10');
    await user.click(screen.getByRole('button', { name: /add folder/i }));
    await user.type(screen.getByLabelText(/folder 1/i), 'data');
    await user.click(screen.getByRole('button', { name: /^install$/i }));
    expect(screen.getByText(/start with \//i)).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:web`
Expected: FAIL — cannot find `./names`.

- [ ] **Step 3: Implement** — `web/src/lib/names.ts`:

```ts
export const APP_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

export function suggestName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+|[-_.]+$/g, '')
    .slice(0, 63);
}

export function nameProblem(name: string): string | null {
  if (!name) return 'Give the app a name.';
  if (!APP_NAME_PATTERN.test(name)) {
    return 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number (no spaces).';
  }
  return null;
}
```

`web/src/components/InstallDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import type { CatalogEntry } from '../api/types';
import { useSystem } from '../lib/guide';
import { nameProblem, suggestName } from '../lib/names';
import { AppIcon } from './AppIcon';
import { GuideView } from './GuideView';

export function InstallDialog({ entry, onClose }: { entry: CatalogEntry; onClose(): void }) {
  const [name, setName] = useState(entry.id);
  const [port, setPort] = useState<number | ''>('');
  const [portTouched, setPortTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const system = useSystem();
  const navigate = useNavigate();

  useEffect(() => {
    api<{ port: number }>('GET', `/api/ports/suggest?preferred=${entry.defaultHostPort}`)
      .then(({ port: p }) => setPort((current) => (current === '' ? p : current)))
      .catch(() => undefined);
  }, [entry.defaultHostPort]);

  const problem = nameProblem(name);
  const suggestion = problem ? suggestName(name) : null;

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/apps', {
        catalogId: entry.id,
        name,
        ...(portTouched && port !== '' ? { hostPort: port } : {}),
      });
      navigate('/');
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  return (
    <div className="card" role="dialog" aria-label={`Install ${entry.name}`}>
      <div className="row app-card" style={{ cursor: 'default' }}>
        <AppIcon iconUrl={entry.iconUrl} name={entry.name} />
        <strong>{entry.name}</strong>
      </div>
      <p className="hint">{entry.description}</p>
      {entry.guide.server && <GuideView guide={entry.guide} system={system} part="server" />}
      <label htmlFor="install-name">Name</label>
      <input id="install-name" value={name} onChange={(e) => setName(e.target.value)} />
      {problem && (
        <p className="error">
          {problem}{' '}
          {suggestion && suggestion !== name && (
            <button type="button" onClick={() => setName(suggestion)}>Use {suggestion}</button>
          )}
        </p>
      )}
      <details>
        <summary>Advanced</summary>
        <label htmlFor="install-port">Port</label>
        <input
          id="install-port"
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => {
            setPortTouched(true);
            setPort(e.target.value === '' ? '' : Number(e.target.value));
          }}
        />
        <p className="hint">The app will open at this port on your server. Leave it as suggested unless you need a specific one.</p>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" disabled={busy || problem !== null} onClick={() => void install()}>
          Install {entry.name}
        </button>
      </div>
    </div>
  );
}
```

`web/src/components/CustomImageForm.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { nameProblem } from '../lib/names';

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** "/app/data" → "app-data": a safe folder name derived from the path inside the app. */
export function volumeNameFor(containerPath: string): string {
  return containerPath.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'data';
}

export function CustomImageForm({ onClose }: { onClose(): void }) {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [hostPort, setHostPort] = useState<number | ''>(8080);
  const [containerPort, setContainerPort] = useState<number | ''>('');
  const [env, setEnv] = useState<Array<{ key: string; value: string }>>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const filledEnv = env.filter((e) => e.key || e.value);
    const filledFolders = folders.filter(Boolean);
    const problem =
      nameProblem(name) ??
      (!image ? 'Enter the image to install.' : null) ??
      (hostPort === '' ? 'Enter a port.' : null) ??
      (filledEnv.some((e) => !ENV_KEY.test(e.key)) ? 'Setting names can use letters, numbers and underscores, and cannot start with a number.' : null) ??
      (filledFolders.some((f) => !f.startsWith('/')) ? 'Folder paths inside the app start with /, for example /data.' : null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await api('POST', '/api/apps', {
        name,
        image,
        hostPort,
        ...(containerPort !== '' ? { containerPort } : {}),
        ...(filledEnv.length ? { env: Object.fromEntries(filledEnv.map((e) => [e.key, e.value])) } : {}),
        ...(filledFolders.length
          ? { volumes: filledFolders.map((containerPath) => ({ name: volumeNameFor(containerPath), containerPath })) }
          : {}),
      });
      navigate('/');
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  };

  const num = (v: string): number | '' => (v === '' ? '' : Number(v));
  return (
    <form className="card" onSubmit={submit} aria-label="Install a custom image">
      <p className="hint">For apps not in the catalog. You need the image name from the app's documentation.</p>
      <label htmlFor="c-name">App name</label>
      <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="c-image">Image</label>
      <input id="c-image" placeholder="publisher/app:1.0" value={image} onChange={(e) => setImage(e.target.value)} />
      <label htmlFor="c-host">Port on the server</label>
      <input id="c-host" type="number" value={hostPort} onChange={(e) => setHostPort(num(e.target.value))} />
      <label htmlFor="c-container">Port inside the app</label>
      <input id="c-container" type="number" placeholder="Same as above" value={containerPort} onChange={(e) => setContainerPort(num(e.target.value))} />

      <h2>Settings (optional)</h2>
      <p className="hint">Environment variables from the app's documentation, such as TZ.</p>
      {env.map((row, i) => (
        <div key={i} className="actions">
          <input aria-label={`Setting ${i + 1} name`} placeholder="NAME" value={row.key}
            onChange={(e) => setEnv(env.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
          <input aria-label={`Setting ${i + 1} value`} placeholder="value" value={row.value}
            onChange={(e) => setEnv(env.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
        </div>
      ))}
      <button type="button" onClick={() => setEnv([...env, { key: '', value: '' }])}>Add setting</button>

      <h2>Folders to keep (optional)</h2>
      <p className="hint">Folders inside the app whose files should survive restarts and reinstalls, such as /data. EasyHost stores them in the app's data folder.</p>
      {folders.map((folder, i) => (
        <input key={i} aria-label={`Folder ${i + 1}`} placeholder="/data" value={folder}
          onChange={(e) => setFolders(folders.map((f, j) => (j === i ? e.target.value : f)))} />
      ))}
      <button type="button" onClick={() => setFolders([...folders, ''])}>Add folder</button>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>Install</button>
      </div>
    </form>
  );
}
```

`web/src/pages/AddPage.tsx`:

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CatalogEntry } from '../api/types';
import { AppIcon } from '../components/AppIcon';
import { CustomImageForm } from '../components/CustomImageForm';
import { InstallDialog } from '../components/InstallDialog';
import { useCatalog } from '../lib/catalog';

const ALL = 'All';

export function AddPage() {
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [custom, setCustom] = useState(false);

  const installId = params.get('install');
  const selected = catalog?.find((c) => c.id === installId);
  const open = (entry: CatalogEntry) => setParams({ install: entry.id });
  const close = () => setParams({});

  if (!catalog) return <p>Loading…</p>;
  const categories = [ALL, ...new Set(catalog.map((c) => c.category))];
  const q = query.trim().toLowerCase();
  const shown = catalog.filter(
    (c) => (category === ALL || c.category === category) &&
      (!q || c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)),
  );

  return (
    <>
      <h1>Add an app</h1>
      {selected && <InstallDialog key={selected.id} entry={selected} onClose={close} />}
      {custom && <CustomImageForm onClose={() => setCustom(false)} />}
      <input type="search" placeholder="Search apps" aria-label="Search apps" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="tabs">
        {categories.map((c) => (
          <button key={c} type="button" aria-pressed={c === category} onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      <div className="grid">
        {shown.map((entry) => (
          <div key={entry.id} className="card">
            <div className="row app-card" style={{ cursor: 'default' }}>
              <AppIcon iconUrl={entry.iconUrl} name={entry.name} />
              <strong>{entry.name}</strong>
            </div>
            <p className="hint">{entry.description}</p>
            <button type="button" className="primary" onClick={() => open(entry)}>Install</button>
          </div>
        ))}
      </div>
      {shown.length === 0 && <p className="hint">No apps match your search.</p>}
      <p><button type="button" onClick={() => setCustom(true)}>Install a custom image</button></p>
    </>
  );
}
```

Card buttons are labelled just "Install" (found within their card in tests); the dialog's button is "Install <name>", so the two never collide.

Add `<Route path="/add" element={<AddPage />} />` inside the `Layout` route.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat: add the catalog screen with one-click installs and custom images"
```

---

### Task 21: Settings and status banners

**Files:**
- Modify: `web/src/pages/SettingsPage.tsx`
- Create: `web/src/components/Banners.tsx`
- Modify: `web/src/components/Layout.tsx`
- Create: `web/src/pages/SettingsPage.test.tsx`, `web/src/components/Banners.test.tsx`

**Interfaces:**
- Consumes: Task 16 `api`, `messageFor`; Task 17 `useAuth`, `passwordProblem`; Task 19 `useSystem`.
- Produces: `Banners` (polls `/health` every 10 s; renders nothing when all is well), Settings actions: change password, new recovery code (confirms the password, then navigates to `/recovery-code` with `next: '/settings'`), log out, version.

- [ ] **Step 1: Write the failing tests** — `web/src/components/Banners.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { Banners } from './Banners';

describe('Banners', () => {
  it('says when Docker is not running', async () => {
    mockApi([{ method: 'GET', path: '/health', body: { ok: true, docker: false } }]);
    render(<Banners />);
    expect(await screen.findByText(/docker isn't running on the server/i)).toBeInTheDocument();
  });

  it('says when the server cannot be reached, and clears once it is back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    render(<Banners />);
    expect(await screen.findByText(/can't reach easyhost/i)).toBeInTheDocument();
    mockApi([{ method: 'GET', path: '/health', body: { ok: true, docker: true } }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.queryByText(/can't reach easyhost/i)).not.toBeInTheDocument();
  });

  it('shows nothing when everything is fine', async () => {
    const api = mockApi([{ method: 'GET', path: '/health', body: { ok: true, docker: true } }]);
    const { container } = render(<Banners />);
    await vi.waitFor(() => expect(api.calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});
```

`web/src/pages/SettingsPage.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { mockApi } from '../test/fetch-mock';
import { renderApp } from '../test/render';

const base = [
  { method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: true } },
  { method: 'GET', path: '/health', body: { ok: true, docker: true } },
  { method: 'GET', path: '/api/system', body: { os: 'linux', distros: [], version: '0.2.0' } },
];

describe('Settings', () => {
  it('shows the version', async () => {
    mockApi(base);
    renderApp('/settings');
    expect(await screen.findByText(/version 0\.2\.0/i)).toBeInTheDocument();
  });

  it('changes the password', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/auth/password', status: 204 }]);
    const { user } = renderApp('/settings');
    await user.type(await screen.findByLabelText(/current password/i), 'old password!!');
    await user.type(screen.getByLabelText(/^new password$/i), 'new password!!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new password!!');
    await user.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    expect(api.calls.find((c) => c.path === '/api/auth/password')?.body).toEqual({
      currentPassword: 'old password!!',
      newPassword: 'new password!!',
    });
  });

  it('explains a wrong current password', async () => {
    mockApi([...base, { method: 'POST', path: '/api/auth/password', status: 401, body: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } } }]);
    const { user } = renderApp('/settings');
    await user.type(await screen.findByLabelText(/current password/i), 'wrong wrong!!');
    await user.type(screen.getByLabelText(/^new password$/i), 'new password!!');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new password!!');
    await user.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByText('Wrong password.')).toBeInTheDocument();
  });

  it('creates a new recovery code after confirming the password', async () => {
    mockApi([...base, { method: 'POST', path: '/api/auth/recovery-code', body: { recoveryCode: 'ZZZZZ-YYYYY-XXXXX-WWWWW' } }]);
    const { user } = renderApp('/settings');
    await user.type(await screen.findByLabelText(/confirm with your password/i), 'my password!!');
    await user.click(screen.getByRole('button', { name: /new recovery code/i }));
    expect(await screen.findByText('ZZZZZ-YYYYY-XXXXX-WWWWW')).toBeInTheDocument();
  });

  it('logs out', async () => {
    const api = mockApi([...base, { method: 'POST', path: '/api/auth/logout', status: 204 }]);
    const { user } = renderApp('/settings');
    await user.click(await screen.findByRole('button', { name: /log out/i }));
    api.handlers.push({ method: 'GET', path: '/api/auth/status', body: { setupRequired: false, authenticated: false } });
    expect(await screen.findByRole('heading', { name: /log in/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:web`
Expected: FAIL — cannot find `./Banners`.

- [ ] **Step 3: Implement** — `web/src/components/Banners.tsx`:

```tsx
import { useEffect, useState } from 'react';

type Health = 'ok' | 'docker-down' | 'unreachable' | 'unknown';

export function Banners() {
  const [health, setHealth] = useState<Health>('unknown');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/health');
        const body = (await res.json()) as { docker?: boolean };
        if (!cancelled) setHealth(body.docker ? 'ok' : 'docker-down');
      } catch {
        if (!cancelled) setHealth('unreachable');
      }
    };
    void check();
    const timer = setInterval(() => void check(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (health === 'unreachable') {
    return <div className="banner" role="alert">Can't reach EasyHost. Check that the server is on. Retrying…</div>;
  }
  if (health === 'docker-down') {
    return <div className="banner" role="alert">Docker isn't running on the server, so apps can't start.</div>;
  }
  return null;
}
```

In `Layout`, render `<Banners />` as the first child of `<main className="content">`.

`web/src/pages/SettingsPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { messageFor } from '../api/messages';
import { useAuth } from '../auth';
import { useSystem } from '../lib/guide';
import { passwordProblem } from './SetupPage';

export function SettingsPage() {
  const system = useSystem();
  const navigate = useNavigate();
  const { markLoggedOut } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [codePassword, setCodePassword] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(next, confirm);
    if (problem) return setPwMessage({ ok: false, text: problem });
    try {
      await api('POST', '/api/auth/password', { currentPassword: current, newPassword: next });
      setPwMessage({ ok: true, text: 'Password changed. Other devices have been logged out.' });
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setPwMessage({ ok: false, text: messageFor(err) });
    }
  };

  const newRecoveryCode = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const { recoveryCode } = await api<{ recoveryCode: string }>('POST', '/api/auth/recovery-code', { password: codePassword });
      navigate('/recovery-code', { state: { code: recoveryCode, next: '/settings' } });
    } catch (err) {
      setCodeError(messageFor(err));
    }
  };

  const logout = async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    markLoggedOut();
  };

  return (
    <>
      <h1>Settings</h1>

      <form className="card" onSubmit={changePassword}>
        <h2>Change password</h2>
        <label htmlFor="s-current">Current password</label>
        <input id="s-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label htmlFor="s-new">New password</label>
        <input id="s-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        <label htmlFor="s-confirm">Confirm new password</label>
        <input id="s-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {pwMessage && <p className={pwMessage.ok ? 'hint' : 'error'} role="status">{pwMessage.text}</p>}
        <p><button className="primary" type="submit">Change password</button></p>
      </form>

      <form className="card" onSubmit={newRecoveryCode} style={{ marginTop: '1rem' }}>
        <h2>Recovery code</h2>
        <p className="hint">Lost your recovery code? Create a new one. The old one stops working.</p>
        <label htmlFor="s-code-pw">Confirm with your password</label>
        <input id="s-code-pw" type="password" autoComplete="current-password" value={codePassword} onChange={(e) => setCodePassword(e.target.value)} />
        {codeError && <p className="error" role="alert">{codeError}</p>}
        <p><button type="submit">New recovery code</button></p>
      </form>

      <section style={{ marginTop: '1rem' }}>
        <button type="button" onClick={() => void logout()}>Log out</button>
        {system?.version && <p className="hint">EasyHost version {system.version}</p>}
      </section>
    </>
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:web && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat: add settings and server status banners"
```

---

### Task 22: CI, build integration and verification in a real browser

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/specs/2026-09-29-easyhost-web-ui-design.md` (Status line only)

**Interfaces:**
- Consumes: everything above.
- Produces: a CI run covering backend and web, and a written verification report in the final hand-off message.

- [ ] **Step 1: Update CI** — replace the steps after `Generate Prisma client` in `.github/workflows/ci.yml`:

```yaml
      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Test
        run: npx jest --coverage && npm run test:web

      - name: Build
        run: npm run build
```

- [ ] **Step 2: Run the full suite locally**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS; `web/dist/index.html` exists.

- [ ] **Step 3: Start EasyHost as a user would**

Run: `docker version` to find out whether a Docker daemon is available on this machine, then with a fresh throwaway database and data folder:

```bash
DATABASE_URL="file:./verify.db" DATA_DIR="./verify-data" npx prisma migrate deploy
DATABASE_URL="file:./verify.db" DATA_DIR="./verify-data" DOCKER_SOCKET_PATH=/var/run/docker.sock npm start
```

On Windows with Docker Desktop, set `DOCKER_HOST=npipe:////./pipe/docker_engine` instead of `DOCKER_SOCKET_PATH`. Delete `verify.db` and `verify-data/` afterwards (both are gitignored by `*.db` and must be added to `.gitignore` as `verify-data/` if not covered).

- [ ] **Step 4: Walk through the golden path in a browser** (use the browser automation tools when available; record each result):

1. Open `http://localhost:3000` → "Welcome to EasyHost". Create a password → recovery code screen, Continue enabled without ticking anything → Home empty state with four suggestions.
2. Install Uptime Kuma from a suggestion → card shows "Installing…", then "Running" within a few polls. Open → Uptime Kuma loads at `http://localhost:3001`.
3. App page shows the guide, logs, data folder. Stop → Stopped; Start → Running.
4. Settings → New recovery code with the password → new code shown. Log out → login screen.
5. Forgot password → use the recovery code from step 4, set a new password → new code shown → Home. The old password no longer works.
6. Remove Uptime Kuma keeping data → Home says it was removed; the data folder still exists under `verify-data/apps/`. Reinstall and remove with "Delete data too" → the folder is gone.
7. Resize to 390 px wide → bottom navigation bar; cards and dialogs fit without horizontal scrolling.
8. Stop the Docker daemon (or point `DOCKER_HOST` at a dead address and restart) → the "Docker isn't running" banner appears.

If Docker is not available, do steps 1, 4, 5 and 7 and state clearly in the report that installing, opening and removing real apps (steps 2, 3, 6, 8) were not verified in a browser.

- [ ] **Step 5: Mark the spec implemented** — change `Status: Draft — awaiting owner review` to `Status: Implemented` in the spec.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml docs/superpowers/specs/2026-09-29-easyhost-web-ui-design.md .gitignore
git commit -m "ci: typecheck, lint, test and build the web interface"
```

Do not push; report the verification results to the owner, including anything that could not be verified.
