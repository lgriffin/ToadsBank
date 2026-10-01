-- Port contracts, as documented tables. The core talks to the WoW client only through these; adapters/wow implements
-- the driven ports in the game, and spec/fakes implements them on a laptop (TB-DM-02). Every method is called with
-- a colon (port:method(...)). Ports.check lists what an implementation is missing; Bootstrap and the specs use it.
local _, ns = ...

local Ports = {}

Ports.BankPort = {
  side = "driven",
  methods = {
    supportsGuildBank = "() -> boolean. false where the client lacks the guild bank API (TB-DM-04)",
    isOpen = "() -> boolean. Whether the guild bank window is open now",
    getSourceIdentity = "() -> {guild, realm, region, uploaderName, uploaderRealm}; guild nil when not in a guild",
    listTabs = "() -> sequence of {index, name, viewable}; viewable=false for tabs the player may not see",
    queryTab = "(index) -> true | false, reason. Asks the client for the tab; the answer is an update signal",
    readTabSlots = "(index) -> sequence of {slot, itemId, count, link} for occupied slots | nil, reason. One pass:"
      .. " item ID, link, slot index and count are captured at once",
    getCapacity = "(index) -> integer slots in the tab. Never hardcoded in the core",
    getMoney = "() -> copper | nil. Optional",
    subscribeToUpdates = "(listener) -> unsubscribe(). listener(event) with event.type 'changed' (event.tab = the"
      .. " tab the signal is for, or nil when the client cannot tell; event.ambiguous = true when the tab's data did"
      .. " not visibly change, so the signal may belong to an earlier query), 'uncertain' (event.tab = a tab read"
      .. " earlier whose data can no longer be verified), 'opened' or 'closed'",
  },
}

Ports.CapabilityPort = {
  side = "driven",
  methods = {
    getProfile = "() -> {flavour, build, interface, supportsGuildBank}. Fixed for a session",
  },
}

Ports.StorePort = {
  side = "driven",
  methods = {
    loadLastSnapshot = "() -> snapshot | nil. The last complete snapshot",
    saveSnapshot = "(snapshot) -> (). Becomes the last snapshot and the newest history entry",
    history = "() -> sequence of snapshots, newest first, bounded",
    getPreference = "(key) -> value | nil",
    setPreference = "(key, value) -> ()",
  },
}

Ports.ClockPort = {
  side = "driven",
  methods = {
    now = "() -> epoch seconds",
    schedule = "(delaySeconds, fn) -> cancel(). Runs fn once after the delay unless cancelled",
  },
}

Ports.ScanUseCase = {
  side = "driving",
  methods = {
    start = "() -> true | false, reason ('unsupported', 'bank_closed', 'no_guild', 'busy')",
    abort = "(reason?) -> true | false, 'not_scanning'",
    status = "() -> {state, reason, tab, tabsDone, tabsTotal, snapshotId}",
    subscribe = "(listener) -> (). listener(status) on every state change",
  },
}

Ports.ExportUseCase = {
  side = "driving",
  methods = {
    exportLatest = "() -> {snapshotId, crc32, parts} | nil, reason, issues",
    exportSnapshot = "(snapshot) -> {snapshotId, crc32, parts} | nil, reason, issues",
  },
}

-- Returns true, or false and the sorted names of the methods impl lacks.
function Ports.check(portName, impl)
  local port = Ports[portName]
  assert(type(port) == "table" and port.methods, "unknown port " .. tostring(portName))
  local missing = {}
  for name in pairs(port.methods) do
    if name ~= "getMoney" and (type(impl) ~= "table" or type(impl[name]) ~= "function") then
      missing[#missing + 1] = name
    end
  end
  table.sort(missing)
  return #missing == 0, missing
end

function Ports.assert(portName, impl)
  local ok, missing = Ports.check(portName, impl)
  if not ok then
    error(portName .. " implementation lacks: " .. table.concat(missing, ", "), 2)
  end
  return impl
end

ns.Ports = Ports
