# ToadsBank

The Toads guild bank: a Lua addon (`addon/`) that observes the guild bank and exports versioned snapshots as text,
and a TypeScript service (`toadsbank-api`, `toadsbank-worker`) that imports them and runs requests, reservations,
raids and deliveries. The website and Discord side live in the Toads hub (`lgriffin/toads`), see
`docs/adr/0002-site-and-discord-live-in-the-toads-hub.md`. Source of truth: Leigh's "ToadsBank — Build
Specification" doc.

## Commands

```bash
npm ci
npm run lint && npm run typecheck   # Biome, tsc
npm test                            # unit, contract, architecture, BDD (Vitest)
npm run trace                       # EARS -> scenario -> test traceability (TB-DM-10)
TOADSBANK_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:integration
npm run fixtures                    # regenerate contracts/fixtures after a contract change
docker compose -f docker/compose.test.yaml run --rm addon-test   # luacheck + busted
(cd addon && lua5.1 spec/run.lua)   # the addon specs without luarocks (busted-compatible runner)
sh addon/pack.sh                    # addon/dist/ToadsBank-<version>.zip, interfaces from addon/clients.lua
sh docker/init-secrets.sh && docker compose -f docker/compose.yaml up   # the stack
```

## Rules

- Hexagonal: `packages/domain` imports nothing outside itself; `packages/application` imports domain and its own
  ports; adapters never import each other. `tests/architecture.test.ts` enforces it. Apps are composition roots.
- Requirements first: every capability has an EARS line in `requirements/*.ears` and a scenario in `features/`
  tagged with its ID, in the same PR. Run `npm run trace:write` and lower `requirements/trace-ratchet.json` when
  statements become linked.
- The contract is shared: change `contracts/` and both codecs together, regenerate fixtures, and bump
  `schemaVersion` for any schema change.
- Every mutating use case takes an idempotency key and, where an entity exists, its expected revision.
- Config from environment, secrets from `*_FILE`. Never commit secrets. Pin image tags.
- All changes go through PRs; never push directly to main.
