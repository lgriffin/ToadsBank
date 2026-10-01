-- Client targets (docs/adr/0004-client-targets.md): flavour -> the .toc that serves it and its interface number.
-- Plain data with no WoW globals, read by pack.sh (`lua5.1 -e 'dofile("addon/clients.lua")'`) to stamp each .toc and
-- by spec/toc_spec.lua to check the checked-in .toc files agree. Not loaded in game.
return {
  forever = {
    toc = "ToadsBank.toc",
    -- TODO(Slice 0 probe): placeholder. WoW Forever's real interface number is open decision 1 (Leigh). Forever is
    -- expected to be a TBC-era-style client, so the TBC Anniversary number stands in until the probe records the
    -- tocversion GetBuildInfo() returns there.
    interface = 20505,
    placeholder = true,
  },
  tbc = {
    toc = "ToadsBank_TBC.toc",
    interface = 20505, -- TBC Anniversary 2.5.5
  },
}
