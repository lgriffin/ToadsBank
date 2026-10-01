-- StorePort on the ToadsBankDB SavedVariables table: the last complete snapshot, a bounded history and preferences.
-- Bootstrap passes the table after ADDON_LOADED; this file itself reads no global, so the specs can give it a plain
-- table. WoW writes the table to WTF/Account/<ACCOUNT>/SavedVariables/ToadsBank.lua on logout or /reload.
local _, ns = ...

local SavedVariablesStore = {}
SavedVariablesStore.__index = SavedVariablesStore

SavedVariablesStore.HISTORY_LIMIT = 5
SavedVariablesStore.DB_VERSION = 1

function SavedVariablesStore.new(db, limit)
  assert(type(db) == "table", "SavedVariablesStore needs the ToadsBankDB table")
  local self = setmetatable({ db = db, limit = limit or SavedVariablesStore.HISTORY_LIMIT }, SavedVariablesStore)
  db.version = db.version or SavedVariablesStore.DB_VERSION
  if type(db.history) ~= "table" then
    db.history = {}
  end
  if type(db.preferences) ~= "table" then
    db.preferences = {}
  end
  self:trim()
  return self
end

function SavedVariablesStore:trim()
  local history = self.db.history
  while #history > self.limit do
    table.remove(history)
  end
end

function SavedVariablesStore:loadLastSnapshot()
  return self.db.lastSnapshot
end

-- Stores a plain copy (no metatables), as the newest history entry too.
function SavedVariablesStore:saveSnapshot(snapshot)
  local copy = ns.Snapshot.copy(snapshot)
  self.db.lastSnapshot = copy
  table.insert(self.db.history, 1, copy)
  self:trim()
end

function SavedVariablesStore:history()
  return self.db.history
end

function SavedVariablesStore:getPreference(key)
  return self.db.preferences[key]
end

function SavedVariablesStore:setPreference(key, value)
  self.db.preferences[key] = value
end

ns.SavedVariablesStore = SavedVariablesStore
