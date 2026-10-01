# Slice 0 capability probe

`ToadsBankProbe` is a throwaway addon that records what a client really offers for guild bank scanning, so the
ToadsBank adapters can be checked against it (open decision 1 and `docs/adr/0004-client-targets.md`). It reads and
writes only its own SavedVariables, `ToadsBankProbeDB`; it does not change the bank or the bank window.

Each run records:

- `client`: `GetBuildInfo()` (version, build, date, interface), `WOW_PROJECT_ID`, `MAX_GUILDBANK_SLOTS_PER_TAB`,
  `MAX_GUILDBANK_TABS`, the guild banker interaction type, whether `bit`, `C_Timer` and `BackdropTemplateMixin`
  exist, the type of every guild bank function the addon uses or might, and which guild bank events the client
  accepted.
- `character`: name, realm, guild, guild rank.
- `tabCount` and, per tab, every value `GetGuildBankTabInfo` returns (name, icon, viewable, deposit, withdrawals).
- Paging each viewable tab one at a time (`QueryGuildBankTab`, then 3 seconds): the occupied slot count, how many
  slots had a link, three sample slots, the current tab before and after, and a re-read of every tab at the end
  (does the client keep data for tabs other than the last one queried?).
- `events`: every guild bank event seen during the run, with its arguments, time and the tab queried at that moment.

## Running it

1. Build it with `sh addon/pack.sh` and unzip `addon/dist/ToadsBankProbe-<version>.zip` into
   `Interface/AddOns/`, or copy `addon/probe/ToadsBankProbe` there. Enable "ToadsBank Probe" at character select.
2. Log in on a character with **full guild bank access** (can view every tab). Open the guild bank, type
   `/tbprobe` and wait until it says the run is saved (about 3 seconds per tab). Do not click tabs meanwhile.
3. Log in on a character with **restricted access** (some tabs not viewable) and do the same.
4. If the client has no guild bank at all, `/tbprobe` still records the client and marks the run unsupported.
5. `/reload` or log out so WoW writes the file. `/tbprobe status` counts runs; `/tbprobe clear` empties the table.

## Where the output lands

WoW writes `WTF/Account/<ACCOUNT>/SavedVariables/ToadsBankProbe.lua` under the client's folder (`_classic_`,
`_anniversary_` or the Forever client's). Copy it unchanged into the repository as

```
addon/spec/fixtures/probe/ToadsBankProbe-<flavour>-<full|restricted>.lua
```

and commit it. Check it first: it holds character, realm and guild names, which are fine to commit for the guild's
own repository. Then use it to replace the placeholders it answers: the Forever interface number in
`addon/clients.lua`, the Forever detection rule in `adapters/wow/ClientCapabilities.lua`, and the event names in
`adapters/wow/GuildBankAdapter.lua`.

## What the probe must confirm

- The Forever client's `GetBuildInfo()` tocversion, and anything that tells it apart from TBC Anniversary.
- That `QueryGuildBankTab(tab)` is answered by `GUILDBANKBAGSLOTS_CHANGED` (with no tab argument), how many times it
  fires per query, and whether it fires for tabs the player cannot view.
- That `GetGuildBankItemInfo` / `GetGuildBankItemLink` return data for a queried tab that is not the current UI tab,
  and keep it after another tab is queried. GuildBankAdapter re-checks the tabs it has read on every
  `GUILDBANKBAGSLOTS_CHANGED` to catch changes during a scan (TB-BM-03); if the client drops that data, every scan
  will come out `stable: false`, and the run's `rereadAtEnd` shows it.
- That links are available in the same frame as the slot's texture and count (the addon retries when not).
- `MAX_GUILDBANK_SLOTS_PER_TAB` (98 assumed when absent) and the open/close events (`GUILDBANKFRAME_OPENED/CLOSED`
  or `PLAYER_INTERACTION_MANAGER_FRAME_SHOW/HIDE`).
