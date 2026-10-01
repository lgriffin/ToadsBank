# 0003 Tooling: npm workspaces, Vitest, Biome, esbuild

Status: accepted (2026-10-01)

- npm workspaces, as the Toads hub's web app uses npm.
- Vitest instead of Jest: the same `describe`/`it`/`expect` API, native TypeScript and ESM, and the hub's web app
  already uses it. Stryker runs it through `@stryker-mutator/vitest-runner`. Cucumber stays Cucumber.
- Biome for lint and format: one pinned binary, no plugin graph.
- esbuild bundles each app into one file, so runtime images hold the bundle and Node only.
