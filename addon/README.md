# ToadsBank addon

Scans the guild bank in game and exports it as a `TOADSBANK/1` snapshot: plain text the player pastes into the Toads
Discord (or the site's import box). The addon makes no network calls; the service validates and imports what is
pasted (`contracts/transport.md`).

## Install

- From a release: unzip `ToadsBank-<version>.zip` into `World of Warcraft/<client>/Interface/AddOns/`, so the folder
  is `Interface/AddOns/ToadsBank/`.
- From a checkout: copy (or symlink) `addon/ToadsBank` to `Interface/AddOns/ToadsBank`. The `.toc` files then show
  `@version@` as the version; that is expected until `pack.sh` stamps it.
- Build the zip yourself with `sh addon/pack.sh` (needs `lua5.1` and `zip`), or
  `docker compose -f docker/compose.test.yaml run --rm addon-pack`. The archives land in `addon/dist/`.

## Use: scan, export, paste

1. Open the guild bank. A small ToadsBank panel appears with the scan status.
2. Press **Scan** or type `/toadsbank scan` (alias `/tbank scan`). Keep the window open: the addon asks for each
   tab in turn and reads it after the client answers. If the bank closes the scan is aborted and the previous
   snapshot is kept. Tabs you cannot see, or that never answer, are exported as `unknown`, never as empty; a tab
   whose contents kept changing during the scan is `unstable` and the snapshot is marked `stable: false`.
3. Press **Export** or type `/toadsbank export`. The export window shows one part at a time (each at most 1,800
   characters). Click in the box (it selects everything), press Ctrl+C, paste into the Discord import modal, then
   press **Next >** for the next part. A Discord text field holds 4,000 characters, so two parts fit in one field.
   Parts can be pasted in any order and over several messages.
4. `/toadsbank status` shows the scan state, the last snapshot and the client profile; `/toadsbank abort` stops a
   scan.

The last complete snapshot and the five most recent ones are kept in `ToadsBankDB`
(`WTF/Account/<ACCOUNT>/SavedVariables/ToadsBank.lua`), so you can export after a `/reload`.

## Client targets

See `docs/adr/0004-client-targets.md`. `clients.lua` maps each flavour to its `.toc` and interface number;
`pack.sh` stamps that number and the version into each `.toc`.

| Flavour | `.toc` | Interface |
| --- | --- | --- |
| `forever` (WoW Forever, the main target) | `ToadsBank.toc` | 20505, a **placeholder** until the Slice 0 probe |
| `tbc` (TBC Anniversary 2.5.5) | `ToadsBank_TBC.toc` | 20505 |

Both `.toc` files list the same files. `ClientCapabilities` derives the snapshot's `client.flavour` from
`GetBuildInfo()` (one marked function decides "Forever"; until the probe it never does) and reports the guild bank
unsupported when its functions are missing, in which case the addon refuses to scan.

## Layout

A small hexagon in Lua 5.1 (`docs/adr/0001-two-hexagons-one-contract.md`):

- `ToadsBank/core/` — pure Lua, no WoW globals: `domain/` (Snapshot, Tab, Slot, Validator), `application/`
  (ScanCoordinator, ExportSnapshot), `serialization/` (JsonEncoder, Base64, Crc32, ExportChunker) and `ports.lua`.
- `ToadsBank/adapters/wow/` — GuildBankAdapter (BankPort), ClientCapabilities (CapabilityPort), SavedVariablesStore
  (StorePort), Timer (ClockPort). `adapters/ui/` — ScanPanel, ExportPanel, SlashCommands.
- `ToadsBank/Bootstrap.lua` — the composition root. WoW has no `require`: every file receives `(addonName, ns)` and
  registers its module in `ns`, in `.toc` order.
- `spec/` — busted specs, FakeBank and other fakes, a fake WoW API for adapter specs; `probe/` — the Slice 0 probe.

## Tests

```bash
cd addon
busted              # CI; config in .busted
luacheck .          # CI; config in .luacheckrc: core files get no WoW globals
lua5.1 spec/run.lua # the same specs with no luarocks: a tiny busted-compatible runner
```

`spec/contract_spec.lua` is the Lua half of the symmetric contract test: from `contracts/fixtures/golden` it must
produce exactly the canonical JSON, CRC and parts the TypeScript service produces.
