-- ExportUseCase: turns a snapshot into TOADSBANK/1 parts the player copies into Discord or the site (TB-BM-05).
-- Canonical JSON, CRC-32 of the whole payload, 1,269-byte chunks, base64. Refuses a snapshot the Validator rejects,
-- so the addon never hands over what the service would refuse.
local _, ns = ...

local ExportSnapshot = {}
ExportSnapshot.__index = ExportSnapshot

-- The snapshot as a JSON value: a copy whose lists (tabs, slots) are marked as arrays, so an empty list stays [].
-- Stored snapshots lose their array marks when WoW writes SavedVariables, hence a fresh copy every export.
function ExportSnapshot.toJsonValue(snapshot)
  local array = ns.JsonEncoder.array
  local value = ns.Snapshot.copy(snapshot)
  local tabs = array(value.tabs or {})
  value.tabs = tabs
  for i = 1, #tabs do
    tabs[i].slots = array(tabs[i].slots or {})
  end
  return value
end

-- Pure encoding: returns {payload, crc32, parts, snapshotId}. bitOps as for Crc32.new.
function ExportSnapshot.encode(snapshot, bitOps)
  local payload = ns.JsonEncoder.encode(ExportSnapshot.toJsonValue(snapshot))
  local crc = ns.Crc32.new(bitOps).hex(payload)
  return {
    snapshotId = snapshot.snapshotId,
    payload = payload,
    crc32 = crc,
    parts = ns.ExportChunker.split(payload, snapshot.snapshotId, crc),
  }
end

-- deps: store (StorePort), clock (ClockPort), bit (bit operations table).
function ExportSnapshot.new(deps)
  local self = setmetatable({}, ExportSnapshot)
  self.store = ns.Ports.assert("StorePort", deps.store)
  self.clock = ns.Ports.assert("ClockPort", deps.clock)
  self.bit = assert(deps.bit, "ExportSnapshot needs bit operations")
  return self
end

function ExportSnapshot:exportSnapshot(snapshot)
  if type(snapshot) ~= "table" then
    return nil, "no_snapshot"
  end
  local ok, issues = ns.Validator.validate(snapshot, math.floor(self.clock:now()))
  if not ok then
    return nil, "invalid_snapshot", issues
  end
  return ExportSnapshot.encode(snapshot, self.bit)
end

function ExportSnapshot:exportLatest()
  return self:exportSnapshot(self.store:loadLastSnapshot())
end

ns.ExportSnapshot = ExportSnapshot
