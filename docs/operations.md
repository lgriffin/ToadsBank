# Operating ToadsBank

How to deploy, configure and look after the guild bank service (`toadsbank-api`, `toadsbank-worker`) and the WoW
addon. ToadsBank has no website or bot of its own: the Toads hub (lgriffin/toads) signs members in, decides who may do
what and runs the bank bot. The hub's side, and the guild-wide admin guide this one belongs to, is
[ADMIN_GUIDE.md in lgriffin/toads](https://github.com/lgriffin/toads/blob/main/ADMIN_GUIDE.md); the hub's bank routes
are in its [docs/bank.md](https://github.com/lgriffin/toads/blob/main/docs/bank.md). The HTTP contract is
[api.md](api.md) and the export format is [contracts/transport.md](../contracts/transport.md).

Never write a secret into this repository, an issue or a chat.

## What runs

| Process | Image | Does |
| --- | --- | --- |
| `db` | `postgres:16.4-alpine3.20` | the bank's own database (one `documents` table plus migrations) |
| `migrate` | `toadsbank-api`, command `migrate` | applies schema migrations, then exits; runs before the API and worker |
| `api` | `toadsbank-api` | the `/v1` HTTP API the hub calls, and `GET /health` |
| `worker` | `toadsbank-worker` | every `WORKER_INTERVAL_MS`: expires raid nights and requests, and delivers outbox events to the hub |

`docker/compose.yaml` is the production-shaped stack: secrets come from files, containers are read-only, image tags are
pinned. `docker/compose.dev.yaml` adds seeded demo data, a published database port and a worker pointed at a hub on
the host. `seed` (`node main.mjs seed`) loads the demo bank and is for development only.

Images are built by `docker build --target api|worker -f docker/Dockerfile .`. CI builds them and smoke-tests the
compose stack but publishes nothing, so a deployment builds its own images or a release workflow is added first
([#3](https://github.com/lgriffin/ToadsBank/issues/3) proposes GitHub Container Registry).

## Settings

Every setting can be given directly or as a file: `NAME_FILE=/path` wins over `NAME` (Docker secrets). A required one
that is missing stops the process.

| Setting | Process | Required | Default | Meaning |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | api, worker, migrate | yes | | `postgresql://toadsbank:<password>@db:5432/toadsbank`. Secret. |
| `TOADSBANK_SERVICE_TOKEN` | api, worker | yes (api; worker when events are sent) | | The token shared with the hub: the hub's `TOADS_BANK_SERVICE_TOKEN`. The API requires it on every `/v1` call; the worker sends it with every event. Secret. |
| `TOADSBANK_EVENTS_URL` | worker | no | empty | The hub's webhook, `https://<hub>/api/bank/events`. Empty: events stay in the outbox and nothing is sent. |
| `PORT` | api | no | `8080` | Port inside the container. |
| `DATABASE_POOL` | api | no | `10` | Database connections in the API's pool (the worker uses 4). |
| `WORKER_INTERVAL_MS` | worker | no | `5000` | Pause between worker ticks. |

Compose-level variables in `docker/compose.yaml`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOADSBANK_REGISTRY` | `toadsbank` | Image name prefix, e.g. `ghcr.io/lgriffin`. |
| `TOADSBANK_TAG` | `dev` | Image tag to run. Pin a real version in production. |
| `TOADSBANK_API_PORT` | `8090` | Host port the API is published on. |
| `TOADSBANK_EVENTS_URL` | empty | Passed to the worker. |
| `TOADSBANK_DB_PORT` | `5433` | Dev overlay only: host port for the database. |

Secrets, as files under `docker/secrets/` (git-ignored):

| File | Holds |
| --- | --- |
| `db_password.txt` | the Postgres password (`POSTGRES_PASSWORD_FILE`) |
| `database_url.txt` | `DATABASE_URL`, with the same password |
| `service_token.txt` | `TOADSBANK_SERVICE_TOKEN` |

`sh docker/init-secrets.sh` writes throwaway random values for local use. For production, write the three files from
your secret store, with a long random service token (`openssl rand -base64 32`), and give the hub the same token.

Tests only: `TOADSBANK_TEST_DATABASE_URL` points `npm run test:integration` at a Postgres.

Policy defaults live in code, not settings: a bank warns after 24 hours without a snapshot and blocks new reservations
after 72 (`DEFAULT_FRESHNESS` in `packages/domain/src/bank/source.ts`); open requests expire after 14 days
(`requestTtlSeconds` in `packages/application/src/context.ts`); an import session lasts 30 minutes. They are the
defaults listed in [#4](https://github.com/lgriffin/ToadsBank/issues/4); changing one is a code change.

## First-time setup

1. Put the stack on the same host or private network as the hub, so the hub reaches `toadsbank-api` without going
   over the internet. Do not expose the API publicly: the service token is its only lock.
2. Write the three secret files. The service token must equal the hub's `TOADS_BANK_SERVICE_TOKEN`.
3. Set `TOADSBANK_EVENTS_URL=https://<hub>/api/bank/events`, `TOADSBANK_REGISTRY` and a pinned `TOADSBANK_TAG`.
4. `docker compose -f docker/compose.yaml up -d`. `migrate` runs first; `GET /health` answers `{"ok":true}` once the
   database is up and migrated.
5. On the hub, set `TOADS_BANK_URL` to the API's address on the private network and restart the hub API.
6. Register the bank (next section), then import its first snapshot.

## Banks (sources)

One physical bank is one source, keyed by guild, realm and region. Each has:

- `name`;
- `audience`: `members` (every guild member sees it) or `officers` (officers only; grant holders never see it);
- `raidDay`: the hub raid day whose officers run it (`wed`, `sun`, ...), or `null` for a guild-wide bank only the
  global tier runs. The hub binds officer actions to it;
- `managers`: Discord user ids who receive the "request assigned" DMs and may work its requests.

Register a bank as a hub global officer or super admin, on the hub's Bank page (`POST /v1/sources` through the hub), or
by accepting the first export from an unregistered bank as an `admin` (it is registered with audience `members` and
the accepting admin as manager; set its `raidDay` and managers afterwards). Edit it the same way (`PATCH`, with the
current revision).

## Roles, as ToadsBank sees them

The hub sends the member's Discord id and roles on every call; ToadsBank trusts the hub for who is who and applies its
own bank rules on top.

| Role | Sent for | Lets them |
| --- | --- | --- |
| `member` | everyone | see `members` banks, request items, cancel their own requests |
| `officer` | an officer on any raid day | see `officers` banks, accept imports, run raids |
| `admin` | a global officer or super admin | everything, including registering and editing banks |
| `uploader` | a call the hub let through for an import grant | accept a snapshot for the banks in `X-Toads-Banks` only |
| `manager` | a call the hub let through for a manage grant | list and work requests for the banks in `X-Toads-Banks` only |

`uploader` and `manager` never reach an officers-only bank, never register banks and never commit raid stock. Who gets
them is decided in the hub (grants and officer tokens, see the hub's admin guide).

## The addon

The addon scans the guild bank in game and exports a `TOADSBANK/1` snapshot as text parts. It makes no network calls.
Usage is in [addon/README.md](../addon/README.md).

### Building and installing

- `sh addon/pack.sh` (needs `lua5.1` and `zip`), or `docker compose -f docker/compose.test.yaml run --rm addon-pack`,
  writes `addon/dist/ToadsBank-<version>.zip` and `ToadsBankProbe-<version>.zip`. The version comes from `$VERSION`,
  else `git describe`.
- Unzip into `World of Warcraft/<client folder>/Interface/AddOns/` so the folder is `Interface/AddOns/ToadsBank/`.
- No release workflow publishes the zip yet: build it and hand it to the officers who scan.

### WoW Forever and TBC

One code base serves both clients (`docs/adr/0004-client-targets.md`):

| Flavour | `.toc` | Interface |
| --- | --- | --- |
| `forever` (main target) | `ToadsBank.toc` | `20505`, a **placeholder** |
| `tbc` (TBC Anniversary 2.5.5) | `ToadsBank_TBC.toc` | `20505` |

- The interface numbers come from `addon/clients.lua`; `pack.sh` stamps them into each `.toc`. To change one, edit
  `clients.lua` (and the checked-in `.toc`, which `spec/toc_spec.lua` compares) and rebuild.
- Until the Forever client has been probed ([#2](https://github.com/lgriffin/ToadsBank/issues/2)), Forever's interface
  number is a stand-in, the addon never detects "Forever" (a TBC-era Forever client's exports say `tbc`), and the guild-bank event names
  are the documented TBC/Classic ones. If the Forever client reports a different interface, WoW lists the addon as
  out of date: tick "Load out of date AddOns" at character select until `clients.lua` is fixed.
- If a client lacks the guild-bank functions, the addon says the bank is unsupported and refuses to scan.

### Running the probe (open decision 1)

To replace the placeholders, install `ToadsBankProbe`, open the guild bank and type `/tbprobe` on a character with full
bank access and on one with restricted access, then `/reload`. Commit
`WTF/Account/<ACCOUNT>/SavedVariables/ToadsBankProbe.lua` from each run as
`addon/spec/fixtures/probe/ToadsBankProbe-<flavour>-<full|restricted>.lua` and update `clients.lua`,
`ClientCapabilities.lua` and `GuildBankAdapter.lua` from it. Steps in [addon/probe/README.md](../addon/probe/README.md).

## Routine operations

### Import a snapshot

1. An officer (or someone with an import grant) opens the guild bank in game and presses **Scan** (or
   `/toadsbank scan`), keeping the window open until it finishes.
2. **Export** (or `/toadsbank export`) shows one part at a time, at most 1,800 characters each.
3. Paste the parts into `/bank import` in Discord (five boxes, two parts per box) or the hub's Bank page, in any order
   and over several goes, within 30 minutes.
4. Check the preview (matched bank, tabs, warnings) and accept. Tabs the scanner could not see keep their previous
   observation; nothing is ever treated as empty because it was unreadable. Accepting the same snapshot again is
   harmless.

Import at least daily before raids: after 24 hours members see a warning, after 72 hours no new reservations are taken.

### Work requests

A request reserves stock when it is made. The bank's managers get a DM with Approve, Reject and Record delivery; the
same queue is on the hub's Bank page. Deliveries can be partial. Requests left open expire after 14 days and release
their stock.

### Stock reviews

When an accepted snapshot shows an item dropping that deliveries do not explain, ToadsBank records an
`unexplained_decrease` review. Reviews never name who took anything. They are reachable through `/v1/reviews`; the hub
does not show them yet.

### Deploy an update

Build or pull the new images, set `TOADSBANK_TAG`, then `docker compose -f docker/compose.yaml up -d`. `migrate` runs
before the API and worker start again.

## Rotating the service token

1. Generate a new token.
2. Write it to `docker/secrets/service_token.txt` and to the hub's `TOADS_BANK_SERVICE_TOKEN`.
3. Restart `api` and `worker` here and the hub API.

While the two sides differ, the hub's bank routes answer 502 and events fail. The worker retries an event for up to
24 hours, so none are lost if both sides change within that window.

The database password: change it in Postgres, update `db_password.txt` and `database_url.txt`, restart.

## Backups

The database volume (`db-data`) holds every bank, snapshot, request, delivery and raid allocation. Back it up once it
holds real data:

```bash
docker compose -f docker/compose.yaml exec db pg_dump -U toadsbank -d toadsbank -Fc > toadsbank-$(date +%F).dump
```

Run it daily, keep several days and copy the dumps off the host. Restore into an empty database with `pg_restore`,
then run `migrate` before starting the API. Keep the secret files in your secret store, not next to the dumps.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Process exits with `X (or X_FILE) is required` | A required setting is missing. |
| `GET /health` answers 503 | The database is down or not migrated: check `migrate`'s logs. |
| Every `/v1` call is 401 | The hub's token differs from `TOADSBANK_SERVICE_TOKEN`. |
| Worker logs `TOADSBANK_EVENTS_URL is not set` | Events are being held; set the URL and restart the worker. They are delivered then. |
| `outbox: 0 delivered, N failed` | The hub is unreachable or refused the token; events retry for 24 hours. |
| `423 source_stale` on a request | The bank has had no snapshot for over 72 hours: import one. |
| `422 unknown_source` on accept | The export is from a bank that is not registered: an admin accepts it to register it. |
| `422 transport_error` on paste | A part was cut or altered while copying: paste it again from the addon. |
| A tab exported as `unknown` | The scanning character cannot view it, or the client never answered: scan with a character that can. |
| Snapshot marked `stable: false` | The bank changed during the scan: scan again when nobody is using it. |
| Addon shows as out of date | The client's interface differs from `clients.lua` (see WoW Forever and TBC). |

## Known limitations

- The Forever interface number and detection are placeholders until the probe runs
  ([#2](https://github.com/lgriffin/ToadsBank/issues/2)).
- No image or addon release is published; hosting, registry and backups are open in
  [#3](https://github.com/lgriffin/ToadsBank/issues/3).
- The hub does not yet expose stock reviews or raid profiles and allocations; they are reachable through the `/v1` API
  only.
- In the hub, bank DMs and posts wait in an in-memory queue, so a hub API restart can lose some
  ([toads#25](https://github.com/lgriffin/toads/issues/25)).
- Defaults awaiting confirmation, and the missing design document, are in
  [#4](https://github.com/lgriffin/ToadsBank/issues/4).
