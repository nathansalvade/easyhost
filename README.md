# EasyHost

**Host your own apps at home, without touching a terminal.**

EasyHost is an open source web app that installs and manages self-hosted apps
(media servers, file sharing, smart home, ad blocking…) on a computer in your
home, such as a Raspberry Pi or an old PC. You pick an app from a catalog, click
Install, and EasyHost downloads it, starts it and shows you how to use it, step
by step, for your system and your devices.

Under the hood every app runs as a [Docker](https://www.docker.com/) container,
but you never need to know that: the words "container", "image" and "port" only
appear in the Advanced sections.

## Features

- **One-click installs** from a built-in catalog of seven apps.
- **Step-by-step guides** for each app: what to do after installing, what to do
  on the server (picked automatically for Ubuntu, Fedora, Windows, macOS…), and
  how to set up each device (router, Windows, Mac, Linux, Android, iPhone).
- **Your data is kept safe:** every app stores its files in its own folder, which
  is kept when the app is removed unless you choose to delete it.
- **Generated passwords** for apps that need one (Pi-hole's admin password),
  shown on the app's page.
- **Plain-language errors**, such as "Port 53 is already used by another program
  on the server", never raw technical messages.
- **Logs, start and stop** for every app.
- **Custom images:** install any Docker image that is not in the catalog.
- **Password protected**, with a recovery code if you forget the password and
  protection against password guessing.
- **Works on phones** (bottom navigation bar) and follows your light/dark theme.
- **Private by design:** no telemetry and no requests to outside services; the
  catalog and icons ship with EasyHost.

## Included apps

| App | What it does | Default port |
|---|---|---|
| [Jellyfin](https://jellyfin.org/) | Stream your movies, shows and music | 8096 |
| [Audiobookshelf](https://www.audiobookshelf.org/) | Audiobooks and podcasts, with synced progress | 13378 |
| [Nextcloud](https://nextcloud.com/) | Files, photos, calendar and contacts | 8080 |
| [File Browser](https://filebrowser.org/) | Upload, download and share files from a browser | 8081 |
| [Home Assistant](https://www.home-assistant.io/) | Control lights, sensors and smart devices | 8123 |
| [Uptime Kuma](https://github.com/louislam/uptime-kuma) | Get alerts when a website or device goes down | 3001 |
| [Pi-hole](https://pi-hole.net/) | Block ads and trackers for your whole home | 8082 (and 53 for DNS) |

If a default port is already taken, EasyHost suggests the next free one.

## Requirements

- **Docker**, running on the same computer:
  - Linux: [Docker Engine](https://docs.docker.com/engine/install/). The user
    running EasyHost must be allowed to use Docker (for example, be in the
    `docker` group).
  - Windows and macOS: [Docker Desktop](https://www.docker.com/products/docker-desktop/).
- **Node.js 20.19 or newer** (22 recommended), with npm.
- **Git**, to download EasyHost.

## Installation

```bash
git clone https://github.com/nathansalvade/easyhost.git
cd easyhost
npm ci
npx prisma generate
npm run build
```

Then create your settings file and the database:

```bash
cp .env.example .env
npx prisma migrate deploy
```

## Running EasyHost

EasyHost reads its settings from **environment variables** (see
[Configuration](#configuration)). Prisma reads `DATABASE_URL` from `.env` by
itself, but the other settings must be set in the environment before starting.

**Linux and macOS** — load every setting from `.env` and start:

```bash
set -a; source .env; set +a
npm start
```

**Windows (PowerShell)** — set the settings you need, then start:

```powershell
$env:DATABASE_URL = "file:./dev.db"
$env:DOCKER_SOCKET_PATH = "//./pipe/docker_engine"
$env:DATA_DIR = "C:\EasyHost\data"
npm start
```

When it is running, the terminal shows:

```
EasyHost is running at http://<server-IP>:3000
```

Open that address from any device on your home network, for example
`http://192.168.1.50:3000`.

### First run

1. **Create your password** (at least 10 characters).
2. **Save your recovery code.** It is the only way back in if you forget your
   password, and it is shown only once. Copy it or download it.
3. You land on the **Home** screen, which suggests a few apps to start with.

### Keeping it running (Linux)

To start EasyHost automatically when the computer boots, create a systemd
service, for example `/etc/systemd/system/easyhost.service`:

```ini
[Unit]
Description=EasyHost
After=network-online.target docker.service
Requires=docker.service

[Service]
User=youruser
WorkingDirectory=/home/youruser/easyhost
EnvironmentFile=/home/youruser/easyhost/.env
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Replace `youruser` and the paths with your own, then run
`sudo systemctl enable --now easyhost`.

## Configuration

All settings are environment variables. `.env.example` lists them with their
defaults.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the EasyHost interface listens on. |
| `HOST` | `0.0.0.0` | Address the interface listens on. `0.0.0.0` makes it reachable from your home network; `127.0.0.1` makes it reachable only from the server itself. |
| `DATABASE_URL` | — (required) | Where EasyHost keeps its database (a SQLite file), e.g. `file:./dev.db`. A relative path is relative to the `prisma/` folder. |
| `DATA_DIR` | `./data` | Folder where each app's data is kept, in `DATA_DIR/apps/<app id>/`. Relative paths are resolved from the folder EasyHost is started in. |
| `DOCKER_SOCKET_PATH` | — | How EasyHost reaches Docker: `/var/run/docker.sock` on Linux and macOS, `//./pipe/docker_engine` on Windows (Docker Desktop). |
| `DOCKER_HOST` | — | Host name of a remote Docker daemon, used instead of `DOCKER_SOCKET_PATH`. Known issue: addresses written as URLs (`tcp://…`, `npipe://…`) do not work yet, so prefer `DOCKER_SOCKET_PATH`. |
| `CONTAINER_BIND_ADDRESS` | `0.0.0.0` | Address the installed apps listen on. `0.0.0.0` makes them reachable from your home network at `http://<server-IP>:<port>`; `127.0.0.1` keeps them reachable only from the server. |
| `TRUST_PROXY` | `false` | Set to `true` only when EasyHost runs behind an HTTPS reverse proxy **on the same computer** (see [Security](#security)). Turns on secure cookies and reads visitors' real addresses from the proxy. |
| `LOG_TAIL_MAX` | `1000` | Maximum number of log lines an app page can request. |

## Adding apps to the catalog

The catalog lives in the `catalog/` folder: one JSON file per app, plus its icon
in `catalog/icons/`. To add an app, create `catalog/<id>.json` (the file name
must match the `id`) and `catalog/icons/<id>.svg`, then restart EasyHost. An
invalid entry stops EasyHost at startup with a message naming the file.

A minimal entry:

```json
{
  "id": "whoami",
  "name": "Who Am I",
  "description": "A tiny web page that shows details about your request.",
  "category": "Monitoring",
  "icon": "icons/whoami.svg",
  "image": "traefik/whoami:v1.10",
  "containerPort": 80,
  "defaultHostPort": 8090,
  "guide": {
    "afterInstall": [{ "text": "Click Open to see the page." }]
  }
}
```

All the fields:

| Field | Required | Description |
|---|---|---|
| `id` | yes | Lowercase letters, numbers and dashes. Also the file name. |
| `name` | yes | Name shown to users. |
| `description` | yes | One sentence, at most 120 characters. |
| `category` | yes | One of `Media`, `Files`, `Smart home`, `Network`, `Monitoring`. |
| `icon` | yes | `icons/<name>.svg`; the file must exist. |
| `image` | yes | Docker image with a **pinned version tag** (it must contain a digit and must not be `latest`), e.g. `jellyfin/jellyfin:12.1`. |
| `containerPort` | yes | Port the app listens on inside its container. |
| `defaultHostPort` | yes | Port suggested on the server. |
| `openPath` | no | Path opened by the Open button, e.g. `/admin`. |
| `env` | no | Environment variables for the app, e.g. `{ "TZ": "Europe/Rome" }`. |
| `volumes` | no | Folders to keep: `[{ "name": "config", "containerPath": "/config" }]`. Each becomes `DATA_DIR/apps/<app id>/<name>`. |
| `fixedPorts` | no | Ports that must be exact: `[{ "containerPort": 53, "hostPort": 53, "protocol": "udp" }]`. |
| `generatedSecrets` | no | Passwords EasyHost generates and passes as environment variables: `[{ "name": "adminPassword", "label": "Admin password", "env": "APP_PASSWORD" }]`. |
| `dataOwner` | no | `{ "uid": 1000, "gid": 1000 }` when the image runs as a fixed non-root user, so its data folders are writable. |
| `guide` | yes | `afterInstall` steps (required), plus optional `server` steps (`linux` with a `default` and per-distribution variants such as `ubuntu`, `windows`, `macos`) and `devices` steps (`router`, `windows`, `macos`, `linux`, `android`, `ios`). Each step is `{ "text": "…", "command": "…" }`, where `command` is optional and gets a Copy button. `{serverAddress}` in a text is replaced with the server's address. |

## Security

- EasyHost controls Docker, which effectively means it controls the server.
  **Do not expose it to the internet.** Home routers keep it private unless you
  forward its port.
- Access is protected by a password (at least 10 characters). Repeated wrong
  attempts are slowed down, and browsers you have logged in with are never
  locked out. If you lose the password, use your recovery code on the
  "Forgot password?" page.
- **Use a hostname of its own for EasyHost.** Browsers share login cookies
  between all ports of the same address, so an installed app opened at
  `http://server:8096` could receive EasyHost's login cookie from
  `http://server:3000`. EasyHost limits the cookie to its own `/api` paths,
  but the complete fix is to open EasyHost on a name no app uses, for example
  `easyhost.home` (set up in Pi-hole or your router), and open apps by the
  server's IP address.
- Only install images you trust.
- For HTTPS, put a reverse proxy (such as Caddy or nginx) **on the same
  computer** in front of EasyHost and set `TRUST_PROXY=true`. A proxy on
  another machine or in a separate Docker container is not trusted for
  visitors' addresses.

## Limitations

- Apps cannot yet use folders that already exist on the server (for example an
  existing movie collection). Put your files in the app's data folder shown on
  its page.
- Reinstalling an app after removing it (with its data kept) starts with a new,
  empty data folder. The old folder stays on disk until you delete it.
- There is one administrator account.
- The interface is in English.

## Development

```bash
npm ci
npx prisma generate
npm run dev        # the server, with DATABASE_URL and Docker settings in the environment
npm run dev:web    # the interface with live reload at http://localhost:5173 (proxies to :3000)
```

| Command | What it does |
|---|---|
| `npm run build` | Builds the server (`dist/`) and the interface (`web/dist/`). |
| `npm start` | Runs the built server, which also serves the interface. |
| `npm test` | Server tests (Jest) and interface tests (Vitest). No Docker needed. |
| `npm run test:e2e` | Browser tests (Playwright) against the built app. Run `npm run build` first; needs Chromium (`npx playwright install chromium`). |
| `npm run typecheck` | TypeScript checks for the server, interface and browser tests. |
| `npm run lint` | ESLint. |

Project layout:

```
src/        server: Express API, Docker, authentication, catalog, installs
web/        interface: React + Vite
catalog/    app catalog (JSON) and icons
prisma/     database schema and migrations (SQLite)
e2e/        browser tests
docs/       design documents and plans
```

Every push and pull request runs typecheck, lint, tests and the build on
Node 20 and 22, plus the browser tests, on GitHub Actions.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, please run
`npm run typecheck`, `npm run lint` and `npm test`.

## License

EasyHost is released under the [MIT License](LICENSE).

The apps in the catalog are separate projects with their own licenses. EasyHost
only downloads their official images; it does not include or modify them.
