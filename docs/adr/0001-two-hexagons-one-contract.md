# 0001 Two hexagons joined by one contract

Status: accepted (2026-10-01)

ToadsBank is a Lua addon and a TypeScript service in one repository. Each is hexagonal: the domain and application
code depend on ports only, and every Blizzard, Discord, SQL and HTTP call sits in an adapter. The only thing the two
share is `contracts/`: the snapshot JSON Schema, the TOADSBANK/1 transport grammar and golden and invalid fixtures.
Neither side imports the other's code, and both test against the same fixtures (TB-DM-03).

`tests/architecture.test.ts` enforces the service's dependency rules (TB-DM-01); `addon/.luacheckrc` keeps WoW globals
out of the addon's core (TB-DM-02).
