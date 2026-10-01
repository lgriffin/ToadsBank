-- One occupied guild bank slot. Slot index, item ID, count and link are captured together in one read; item names
-- and icons are not part of the snapshot and may resolve later on the service side.
local _, ns = ...

local Slot = {}

Slot.MAX_STACK = 10000
Slot.MAX_ITEM_ID = 2147483647
Slot.MAX_LINK = 512

local floor = math.floor

local function isInt(v, min, max)
  return type(v) == "number" and v == floor(v) and v >= min and v <= max
end

-- Item ID from an item link or item string ("|Hitem:22832:...|h" or "item:22832").
function Slot.itemIdFromLink(link)
  if type(link) ~= "string" then
    return nil
  end
  return tonumber(link:match("item:(%d+)"))
end

-- Builds a slot record; link is optional and dropped when longer than the contract allows.
function Slot.new(slot, itemId, count, link)
  local record = { slot = slot, itemId = itemId, count = count }
  if type(link) == "string" and #link >= 1 and #link <= Slot.MAX_LINK then
    record.link = link
  end
  return record
end

-- true, or false and a reason, for a slot read from a tab of the given capacity.
function Slot.check(record, capacity)
  if type(record) ~= "table" then
    return false, "slot is not a table"
  end
  if not isInt(record.slot, 1, capacity) then
    return false, "slot " .. tostring(record.slot) .. " is outside 1.." .. tostring(capacity)
  end
  if not isInt(record.itemId, 1, Slot.MAX_ITEM_ID) then
    return false, "slot " .. record.slot .. " has no item ID"
  end
  if not isInt(record.count, 1, Slot.MAX_STACK) then
    return false, "slot " .. record.slot .. " has count " .. tostring(record.count)
  end
  return true
end

ns.Slot = Slot
