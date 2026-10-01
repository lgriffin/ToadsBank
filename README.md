# ToadsBank

Guild bank tooling for the Toads guild.

- **Addon** (`addon/`, Lua): scans the guild bank tab by tab and exports a snapshot as copyable text parts. It never
  talks to the network. Targets WoW Forever, and TBC for testing.
- **Service** (`packages/`, `apps/`, TypeScript): imports pasted snapshots, rebuilds each bank slot for slot,
  aggregates stock across banks and raids, and runs requests, reservations and deliveries.
- **Site and Discord**: the bank pages and bot commands live in the Toads hub, which calls this service's HTTP API
  (`docs/api.md`).

Deploying and running it (settings, secrets, the addon on Forever and TBC, backups): `docs/operations.md`.

See `CLAUDE.md` for commands and rules, `contracts/transport.md` for the export format and `docs/adr/` for decisions.
