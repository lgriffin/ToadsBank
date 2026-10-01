-- The rules of contracts/schema/snapshot.v1.json plus the cross-field rules its description lists (unique tab
-- indices and slot numbers, slot <= capacity, completedAt >= capturedAt, no future timestamps), mirroring the
-- service's validator so the addon never exports what the service would reject. Accepts plain tables or tables
-- marked as JSON arrays.
local _, ns = ...

local Validator = {}

Validator.MAX_TABS = 16
Validator.MAX_SLOTS_PER_TAB = 256
Validator.MAX_TIME = 4102444800
Validator.FUTURE_SKEW_SECONDS = 300
Validator.MAX_ISSUES = 50

local floor, type, pairs = math.floor, type, pairs

local Checker = {}
Checker.__index = Checker

local function newChecker()
  return setmetatable({ issues = {} }, Checker)
end

function Checker:fail(path, message)
  if #self.issues < Validator.MAX_ISSUES then
    self.issues[#self.issues + 1] = { path = path, message = message }
  end
end

local function sequenceLength(t)
  if type(t) ~= "table" then
    return nil
  end
  local count = 0
  for k in pairs(t) do
    if type(k) ~= "number" then
      return nil
    end
    count = count + 1
  end
  for i = 1, count do
    if t[i] == nil then
      return nil
    end
  end
  return count
end

function Checker:object(value, path, required, optional)
  if type(value) ~= "table" then
    self:fail(path, "must be an object")
    return false
  end
  local allowed = {}
  for _, key in ipairs(required) do
    allowed[key] = true
  end
  for _, key in ipairs(optional or {}) do
    allowed[key] = true
  end
  for key in pairs(value) do
    if type(key) ~= "string" or not allowed[key] then
      self:fail(path .. "/" .. tostring(key), "is not allowed")
    end
  end
  for _, key in ipairs(required) do
    if value[key] == nil then
      self:fail(path .. "/" .. key, "is required")
    end
  end
  return true
end

function Checker:int(value, path, min, max)
  if type(value) ~= "number" or value ~= floor(value) or value < min or value > max then
    self:fail(path, "must be an integer from " .. string.format("%.0f", min) .. " to " .. string.format("%.0f", max))
    return false
  end
  return true
end

function Checker:string(value, path, min, max, pattern)
  local ok = type(value) == "string"
  if ok then
    local length = ns.Snapshot.length(value)
    ok = length >= min and length <= max and (pattern == nil or value:match(pattern) ~= nil)
  end
  if not ok then
    local message = "must be a string of " .. min .. " to " .. max .. " characters"
    if pattern then
      message = "must match " .. pattern
    end
    self:fail(path, message)
  end
  return ok
end

local function checkSlots(c, tab, path, capacity)
  local count = sequenceLength(tab.slots)
  if count == nil or count > Validator.MAX_SLOTS_PER_TAB then
    c:fail(path .. "/slots", "must be an array of at most " .. Validator.MAX_SLOTS_PER_TAB .. " slots")
    return
  end
  if tab.status ~= "observed" and count > 0 then
    c:fail(path .. "/slots", "must be empty unless the tab was observed")
  end
  local seen = {}
  for s = 1, count do
    local slot = tab.slots[s]
    local slotPath = path .. "/slots/" .. (s - 1)
    if c:object(slot, slotPath, { "slot", "itemId", "count" }, { "link" }) then
      if c:int(slot.slot, slotPath .. "/slot", 1, capacity) then
        if seen[slot.slot] then
          c:fail(slotPath .. "/slot", "duplicates slot " .. slot.slot)
        end
        seen[slot.slot] = true
      end
      c:int(slot.itemId, slotPath .. "/itemId", 1, 2147483647)
      c:int(slot.count, slotPath .. "/count", 1, 10000)
      if slot.link ~= nil then
        c:string(slot.link, slotPath .. "/link", 1, 512)
      end
    end
  end
end

local function checkTabs(c, tabs, now)
  local count = sequenceLength(tabs)
  if count == nil or count > Validator.MAX_TABS then
    c:fail("/tabs", "must be an array of at most " .. Validator.MAX_TABS .. " tabs")
    return
  end
  local indices = {}
  for t = 1, count do
    local tab = tabs[t]
    local path = "/tabs/" .. (t - 1)
    if c:object(tab, path, { "index", "name", "status", "capacity", "observedAt", "slots" }) then
      if c:int(tab.index, path .. "/index", 1, Validator.MAX_TABS) then
        if indices[tab.index] then
          c:fail(path .. "/index", "duplicates tab " .. tab.index)
        end
        indices[tab.index] = true
      end
      c:string(tab.name, path .. "/name", 0, 64)
      if tab.status ~= "observed" and tab.status ~= "unknown" and tab.status ~= "unstable" then
        c:fail(path .. "/status", "must be observed, unknown or unstable")
      end
      local capacity = Validator.MAX_SLOTS_PER_TAB
      if c:int(tab.capacity, path .. "/capacity", 0, Validator.MAX_SLOTS_PER_TAB) then
        capacity = tab.capacity
      end
      if c:int(tab.observedAt, path .. "/observedAt", 0, Validator.MAX_TIME) and now
        and tab.observedAt > now + Validator.FUTURE_SKEW_SECONDS then
        c:fail(path .. "/observedAt", "is in the future")
      end
      checkSlots(c, tab, path, capacity)
    end
  end
end

local TOP_REQUIRED = {
  "schema", "schemaVersion", "snapshotId", "addon", "client", "source", "uploader", "capturedAt", "completedAt",
  "stable", "tabs",
}

local function checkHeader(c, value)
  if value.schema ~= "toadsbank.snapshot" then
    c:fail("/schema", "must be toadsbank.snapshot")
  end
  if value.schemaVersion ~= 1 then
    c:fail("/schemaVersion", "must be 1")
  end
  c:string(value.snapshotId, "/snapshotId", 8, 48, "^[A-Za-z0-9%-]+$")
  if c:object(value.addon, "/addon", { "version" }) then
    c:string(value.addon.version, "/addon/version", 1, 32)
  end
  if c:object(value.client, "/client", { "flavour", "build", "interface" }) then
    c:string(value.client.flavour, "/client/flavour", 1, 24, "^[a-z0-9_]+$")
    c:string(value.client.build, "/client/build", 0, 32)
    c:int(value.client.interface, "/client/interface", 0, 9999999)
  end
  if c:object(value.source, "/source", { "kind", "guild", "realm", "region" }, { "configuredSourceId" }) then
    if value.source.kind ~= "guildBank" then
      c:fail("/source/kind", "must be guildBank")
    end
    c:string(value.source.guild, "/source/guild", 1, 64)
    c:string(value.source.realm, "/source/realm", 1, 64)
    c:string(value.source.region, "/source/region", 0, 8)
    if value.source.configuredSourceId ~= nil then
      c:string(value.source.configuredSourceId, "/source/configuredSourceId", 1, 64)
    end
  end
  if c:object(value.uploader, "/uploader", { "name", "realm" }) then
    c:string(value.uploader.name, "/uploader/name", 1, 24)
    c:string(value.uploader.realm, "/uploader/realm", 1, 64)
  end
end

-- Returns true, or false and a list of {path, message}. now (epoch seconds) enables the future-timestamp rule.
function Validator.validate(value, now)
  local c = newChecker()
  if not c:object(value, "", TOP_REQUIRED, { "money" }) then
    return false, c.issues
  end
  checkHeader(c, value)
  local capturedOk = c:int(value.capturedAt, "/capturedAt", 0, Validator.MAX_TIME)
  local completedOk = c:int(value.completedAt, "/completedAt", 0, Validator.MAX_TIME)
  if capturedOk and completedOk then
    if value.completedAt < value.capturedAt then
      c:fail("/completedAt", "must not be before capturedAt")
    end
    if now and value.completedAt > now + Validator.FUTURE_SKEW_SECONDS then
      c:fail("/completedAt", "is in the future")
    end
  end
  if type(value.stable) ~= "boolean" then
    c:fail("/stable", "must be a boolean")
  end
  if value.money ~= nil then
    c:int(value.money, "/money", 0, 9007199254740991)
  end
  checkTabs(c, value.tabs, now)
  if #c.issues == 0 then
    return true
  end
  return false, c.issues
end

-- One line for a status message.
function Validator.describe(issues)
  local out = {}
  for i = 1, math.min(#(issues or {}), 3) do
    out[#out + 1] = issues[i].path .. " " .. issues[i].message
  end
  return table.concat(out, "; ")
end

ns.Validator = Validator
