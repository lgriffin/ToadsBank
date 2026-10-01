-- One guild bank tab in a snapshot. Only an observed tab carries slots: an unknown tab (inaccessible, timed out,
-- failed) or an unstable one (kept changing) has an empty slots list and is never read as empty (TB-BM-02, TB-BM-03).
local _, ns = ...

local Tab = {}

Tab.OBSERVED = "observed"
Tab.UNKNOWN = "unknown"
Tab.UNSTABLE = "unstable"
Tab.MAX_CAPACITY = 256
Tab.MAX_NAME = 64

local function bySlot(a, b)
  return a.slot < b.slot
end

local function base(index, name, status, capacity, observedAt)
  return {
    index = index,
    name = ns.Snapshot.truncate(name or "", Tab.MAX_NAME),
    status = status,
    capacity = capacity,
    observedAt = observedAt,
    slots = {},
  }
end

-- slots: records from Slot.new; copied and sorted by slot index.
function Tab.observed(index, name, capacity, observedAt, slots)
  local tab = base(index, name, Tab.OBSERVED, capacity, observedAt)
  for i = 1, #slots do
    local s = slots[i]
    tab.slots[i] = ns.Slot.new(s.slot, s.itemId, s.count, s.link)
  end
  table.sort(tab.slots, bySlot)
  return tab
end

function Tab.unknown(index, name, capacity, observedAt)
  return base(index, name, Tab.UNKNOWN, capacity, observedAt)
end

function Tab.unstable(index, name, capacity, observedAt)
  return base(index, name, Tab.UNSTABLE, capacity, observedAt)
end

ns.Tab = Tab
