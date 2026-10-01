-- StorePort fake: an in-memory table with the same bounded history as SavedVariablesStore.
local MemoryStore = {}
MemoryStore.__index = MemoryStore

function MemoryStore.new(limit)
  return setmetatable({ last = nil, entries = {}, prefs = {}, limit = limit or 5, saves = 0 }, MemoryStore)
end

function MemoryStore:loadLastSnapshot()
  return self.last
end

function MemoryStore:saveSnapshot(snapshot)
  self.saves = self.saves + 1
  self.last = snapshot
  table.insert(self.entries, 1, snapshot)
  while #self.entries > self.limit do
    table.remove(self.entries)
  end
end

function MemoryStore:history()
  return self.entries
end

function MemoryStore:getPreference(key)
  return self.prefs[key]
end

function MemoryStore:setPreference(key, value)
  self.prefs[key] = value
end

return MemoryStore
