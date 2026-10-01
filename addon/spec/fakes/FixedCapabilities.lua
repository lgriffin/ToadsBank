-- CapabilityPort fake: a fixed client profile.
local FixedCapabilities = {}
FixedCapabilities.__index = FixedCapabilities

function FixedCapabilities.new(profile)
  return setmetatable({
    profile = profile or { flavour = "tbc", build = "2.5.5.65000", interface = 20505, supportsGuildBank = true },
  }, FixedCapabilities)
end

function FixedCapabilities:getProfile()
  return self.profile
end

return FixedCapabilities
