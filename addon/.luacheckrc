-- luacheck configuration for the addon (run from addon/: `luacheck .`).
-- The core (ToadsBank/core) is plain Lua 5.1: it gets no WoW global at all, so a stray WoW call there fails the
-- check (TB-DM-02). Only the adapters, Bootstrap.lua and the probe may touch the WoW API, each with the list below.
std = "lua51"
max_line_length = 120
unused_args = false
self = false
exclude_files = { "dist/**", ".luarocks/**", "lua_modules/**", "spec/fixtures/**" } -- probe output is data

local WOW_BANK = {
  "Enum", "CreateFrame", "GuildBankFrame", "GetBuildInfo", "GetCurrentRegion", "GetCurrentRegionName",
  "GetGuildInfo", "GetRealmName", "UnitName", "GetNumGuildBankTabs", "GetGuildBankTabInfo", "QueryGuildBankTab",
  "GetGuildBankItemInfo", "GetGuildBankItemLink", "GetGuildBankMoney", "MAX_GUILDBANK_SLOTS_PER_TAB", "C_Timer",
  "GetServerTime", "GetTime", "time",
}

local WOW_UI = {
  "CreateFrame", "UIParent", "UISpecialFrames", "BackdropTemplateMixin", "ChatFontNormal",
}

files["ToadsBank/core/**/*.lua"] = { std = "lua51" }
files["ToadsBank/core/*.lua"] = { std = "lua51" }

files["ToadsBank/adapters/wow/*.lua"] = { read_globals = WOW_BANK }

files["ToadsBank/adapters/ui/*.lua"] = {
  read_globals = WOW_UI,
  globals = { "SLASH_TOADSBANK1", "SLASH_TOADSBANK2", "SlashCmdList" },
}

files["ToadsBank/Bootstrap.lua"] = {
  read_globals = { "CreateFrame", "C_AddOns", "GetAddOnMetadata", "DEFAULT_CHAT_FRAME", "bit" },
  globals = { "ToadsBankDB" },
}

files["probe/**/*.lua"] = {
  read_globals = {
    "CreateFrame", "DEFAULT_CHAT_FRAME", "C_Timer", "GetTime", "time", "GetBuildInfo", "Enum", "WOW_PROJECT_ID",
    "MAX_GUILDBANK_SLOTS_PER_TAB", "MAX_GUILDBANK_TABS", "bit", "BackdropTemplateMixin", "GetNumGuildBankTabs",
    "GetGuildBankTabInfo", "QueryGuildBankTab", "GetGuildBankItemInfo", "GetGuildBankItemLink", "GetGuildBankMoney",
    "GetCurrentGuildBankTab", "GetGuildInfo", "UnitName", "GetRealmName", "GuildBankFrame",
  },
  globals = { "ToadsBankProbeDB", "SLASH_TBPROBE1", "SlashCmdList" },
}

files["spec/**/*.lua"] = { std = "+busted" }
files["spec/*.lua"] = { std = "+busted" }
