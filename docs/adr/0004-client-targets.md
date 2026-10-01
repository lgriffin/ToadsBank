# 0004 Client targets: WoW Forever first, TBC kept working

Status: accepted (2026-10-01). Open decision 1 (exact Forever client and interface version) is still Leigh's.

The addon targets WoW Forever first. TBC Classic stays supported so the guild can test against a client it can run
today and stay compliant where TBC is still in use. One code base serves both:

- Client differences live only in the WoW adapters (`adapters/wow/`), keyed by a client profile that
  ClientCapabilities builds from `GetBuildInfo()`; the core never branches on flavour.
- Each flavour has its own `.toc` (`ToadsBank.toc` for Forever, `ToadsBank_TBC.toc` for TBC) with the interface
  number taken from `addon/clients.lua`. `addon/pack.sh` stamps the version and interface into each `.toc`.
- The snapshot records `client.flavour`, `client.build` and `client.interface`, so the service can tell exports
  apart; the contract does not change between clients.
- Where a client lacks guild-bank functions, the addon reports the source as unsupported and does not scan
  (TB-DM-04).

Until the Slice 0 probe has run on the Forever client, its interface number is a placeholder and the guild-bank
event names in GuildBankAdapter are the ones the TBC/Classic API documents.
