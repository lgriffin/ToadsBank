-- BankPort in WoW, on the classic guild bank API (TBC Anniversary; assumed for Forever until the Slice 0 probe
-- confirms it, docs/adr/0004-client-targets.md).
--
-- GUILDBANKBAGSLOTS_CHANGED carries no tab, so the adapter tags each one with the tab it last queried: the core
-- then treats it as that tab's update signal (TB-BM-01). Bank open/close comes from GUILDBANKFRAME_OPENED/CLOSED
-- and, on clients that have it, PLAYER_INTERACTION_MANAGER_FRAME_SHOW/HIDE for the guild banker.
local _, ns = ...

local GuildBankAdapter = {}
GuildBankAdapter.__index = GuildBankAdapter

GuildBankAdapter.DEFAULT_SLOTS_PER_TAB = 98

local REGIONS = { [1] = "US", [2] = "KR", [3] = "EU", [4] = "TW", [5] = "CN" }

local function guildBankerType()
  local enum = type(Enum) == "table" and Enum.PlayerInteractionType
  return enum and enum.GuildBanker or nil
end

-- capabilities: a CapabilityPort, for supportsGuildBank.
function GuildBankAdapter.new(capabilities)
  local self = setmetatable({}, GuildBankAdapter)
  self.capabilities = capabilities
  self.listeners = {}
  self.open = false
  self.lastQueried = nil
  self.frame = CreateFrame("Frame")
  local events = { "GUILDBANKFRAME_OPENED", "GUILDBANKFRAME_CLOSED", "GUILDBANKBAGSLOTS_CHANGED" }
  if guildBankerType() then
    events[#events + 1] = "PLAYER_INTERACTION_MANAGER_FRAME_SHOW"
    events[#events + 1] = "PLAYER_INTERACTION_MANAGER_FRAME_HIDE"
  end
  for _, event in ipairs(events) do
    -- RegisterEvent raises on an event the client does not know; skip those rather than fail to load.
    pcall(self.frame.RegisterEvent, self.frame, event)
  end
  self.frame:SetScript("OnEvent", function(_, event, ...)
    self:onEvent(event, ...)
  end)
  return self
end

function GuildBankAdapter:onEvent(event, ...)
  if event == "GUILDBANKFRAME_OPENED" then
    self:setOpen(true)
  elseif event == "GUILDBANKFRAME_CLOSED" then
    self:setOpen(false)
  elseif event == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW" or event == "PLAYER_INTERACTION_MANAGER_FRAME_HIDE" then
    local interaction = ...
    if interaction ~= nil and interaction == guildBankerType() then
      self:setOpen(event == "PLAYER_INTERACTION_MANAGER_FRAME_SHOW")
    end
  elseif event == "GUILDBANKBAGSLOTS_CHANGED" then
    self:emit({ type = "changed", tab = self.lastQueried })
  end
end

function GuildBankAdapter:setOpen(open)
  self.open = open
  if open then
    self:emit({ type = "opened" })
  else
    -- Also when the window was open before a /reload and no OPENED event was seen.
    self.lastQueried = nil
    self:emit({ type = "closed" })
  end
end

function GuildBankAdapter:emit(event)
  local listeners = {}
  for i, listener in ipairs(self.listeners) do
    listeners[i] = listener
  end
  for _, listener in ipairs(listeners) do
    listener(event)
  end
end

function GuildBankAdapter:supportsGuildBank()
  local profile = self.capabilities:getProfile()
  return profile.supportsGuildBank == true
end

function GuildBankAdapter:isOpen()
  if self.open then
    return true
  end
  -- Covers a /reload with the bank window open, where no OPENED event arrives.
  local frame = GuildBankFrame
  return type(frame) == "table" and type(frame.IsShown) == "function" and frame:IsShown() and true or false
end

local function region()
  if type(GetCurrentRegionName) == "function" then
    local name = GetCurrentRegionName()
    if type(name) == "string" then
      return name
    end
  end
  if type(GetCurrentRegion) == "function" then
    return REGIONS[GetCurrentRegion()] or ""
  end
  return ""
end

function GuildBankAdapter:getSourceIdentity()
  local guild = GetGuildInfo("player")
  local realm = GetRealmName()
  return {
    guild = guild,
    realm = realm,
    region = region(),
    uploaderName = UnitName("player"),
    uploaderRealm = realm,
  }
end

function GuildBankAdapter:listTabs()
  local tabs = {}
  for index = 1, GetNumGuildBankTabs() or 0 do
    local name, _, isViewable = GetGuildBankTabInfo(index)
    tabs[#tabs + 1] = { index = index, name = name or "", viewable = isViewable and true or false }
  end
  return tabs
end

function GuildBankAdapter:getCapacity()
  local slots = MAX_GUILDBANK_SLOTS_PER_TAB
  if type(slots) == "number" and slots > 0 then
    return slots
  end
  return GuildBankAdapter.DEFAULT_SLOTS_PER_TAB
end

function GuildBankAdapter:getMoney()
  if type(GetGuildBankMoney) == "function" then
    return GetGuildBankMoney()
  end
  return nil
end

function GuildBankAdapter:queryTab(index)
  if not self:isOpen() then
    return false, "bank_closed"
  end
  self.lastQueried = index
  QueryGuildBankTab(index)
  return true
end

-- One synchronous pass over the tab: for each occupied slot, its item ID, link and count together. A slot with an
-- item but no link yet means the client has not got the data: the read fails and the core retries it.
function GuildBankAdapter:readTabSlots(index)
  local slots = {}
  for slot = 1, self:getCapacity(index) do
    local texture, count = GetGuildBankItemInfo(index, slot)
    if texture then
      local link = GetGuildBankItemLink(index, slot)
      if not link then
        return nil, "link_pending"
      end
      local itemId = ns.Slot.itemIdFromLink(link)
      if not itemId then
        return nil, "unreadable_link"
      end
      slots[#slots + 1] = ns.Slot.new(slot, itemId, count or 1, link)
    end
  end
  return slots
end

function GuildBankAdapter:subscribeToUpdates(listener)
  self.listeners[#self.listeners + 1] = listener
  return function()
    for i = #self.listeners, 1, -1 do
      if self.listeners[i] == listener then
        table.remove(self.listeners, i)
      end
    end
  end
end

ns.GuildBankAdapter = GuildBankAdapter
