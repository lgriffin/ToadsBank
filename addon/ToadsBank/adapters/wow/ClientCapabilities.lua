-- CapabilityPort in WoW: the client profile from GetBuildInfo() and whether the guild bank API exists. Client
-- differences live here and in the other WoW adapters only (docs/adr/0004-client-targets.md); the core never
-- branches on flavour.
local _, ns = ...

local ClientCapabilities = {}
ClientCapabilities.__index = ClientCapabilities

-- The guild bank functions GuildBankAdapter needs. Missing any of them means the source is unsupported (TB-DM-04).
ClientCapabilities.GUILD_BANK_API = {
  "GetNumGuildBankTabs",
  "GetGuildBankTabInfo",
  "QueryGuildBankTab",
  "GetGuildBankItemInfo",
  "GetGuildBankItemLink",
}

-- FOREVER DETECTION RULE -- the one place that decides a client is WoW Forever.
-- TODO(Slice 0 probe): WoW Forever's build and tocversion are not known yet (open decision 1). Until the probe's
-- output is committed under spec/fixtures/probe/, no client is detected as Forever; a TBC-era Forever client reports
-- "tbc". When the probe shows how to tell them apart (a tocversion, a WOW_PROJECT_ID, a global only Forever has),
-- encode it here and in spec/client_capabilities_spec.lua.
function ClientCapabilities.isForever(version, build, tocversion)
  return false
end

-- Flavour from the interface number: 20xxx is TBC unless the Forever rule says otherwise.
function ClientCapabilities.flavourFor(version, build, tocversion)
  if ClientCapabilities.isForever(version, build, tocversion) then
    return "forever"
  end
  local toc = tonumber(tocversion) or 0
  if toc >= 20000 and toc < 30000 then
    return "tbc"
  elseif toc >= 10000 and toc < 20000 then
    return "classic_era"
  elseif toc >= 30000 and toc < 40000 then
    return "wrath"
  elseif toc >= 40000 and toc < 50000 then
    return "cata"
  elseif toc >= 50000 and toc < 60000 then
    return "mists"
  elseif toc >= 100000 then
    return "retail"
  end
  return "unknown"
end

function ClientCapabilities.new()
  local self = setmetatable({}, ClientCapabilities)
  local version, build, _, tocversion = GetBuildInfo()
  local supports = true
  for _, name in ipairs(ClientCapabilities.GUILD_BANK_API) do
    if type(_G[name]) ~= "function" then
      supports = false
    end
  end
  local buildText = tostring(version or "")
  if build and build ~= "" then
    buildText = buildText .. "." .. tostring(build)
  end
  self.profile = {
    flavour = ClientCapabilities.flavourFor(version, build, tocversion),
    build = buildText:sub(1, 32),
    interface = tonumber(tocversion) or 0,
    supportsGuildBank = supports,
  }
  return self
end

function ClientCapabilities:getProfile()
  return self.profile
end

ns.ClientCapabilities = ClientCapabilities
