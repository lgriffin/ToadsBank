# 0002 The bank's website and Discord live in the Toads hub

Status: accepted (2026-10-01). Settles open decisions 2 (standalone or hub module) and 3 (web framework).

The spec's layout gives ToadsBank its own `packages/web` and `apps/bot`. Leigh asked instead for the website and
Discord capabilities to be retrofitted into Toads (`lgriffin/toads`), which already has Discord login, RBAC, a
SvelteKit site and a two-way bot kit. So:

- ToadsBank ships the addon and a headless service: `toadsbank-api` (HTTP) and `toadsbank-worker` (outbox, retries,
  expiry) over the same core. There is no `packages/web` and no `apps/bot` here.
- The hub's Discord login replaces the IdentityProvider adapter, as spec §4 anticipated. The hub API calls ToadsBank
  with a shared service token and names the member in `X-Toads-*` headers (`docs/api.md`); the core never sees
  Discord OAuth. Hub RBAC decides who may call which route; ToadsBank still applies its own rules (source audience,
  manager-only actions) to the identity it is given.
- Discord commands, modals, buttons, manager DMs and dashboards are a bank binding in the hub's bot kit
  (`toads_bot.kit`). ToadsBank's worker delivers outbox events to the hub (`TOADSBANK_EVENTS_URL`), and the hub
  routes them to the bot. The ManagerNotifier and DashboardPublisher ports are therefore implemented by an
  "events to hub" adapter here.
- The bank pages are SvelteKit routes in `apps/web` of the hub, talking only to the hub API.

The bot and site still run as separate processes from the bank core, so a Discord outage or a slow retry queue
cannot stall website requests.
