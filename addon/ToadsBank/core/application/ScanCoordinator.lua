-- Sequences a guild bank scan (ScanUseCase). Event and timer driven: it never waits in a loop, it reacts to the
-- BankPort's update signals and the ClockPort's timers.
--
-- Rules (each covered by spec/scan_coordinator_spec.lua against FakeBank):
--   * One tab in flight at a time. A tab's slots are read only after that tab's own update signal, once the signals
--     have been quiet for settleDelay seconds (TB-BM-01).
--   * Each query has a timeout and a bounded number of attempts; a tab that never answers, cannot be read or is not
--     viewable is unknown, never empty (TB-BM-02).
--   * A signal the BankPort marks ambiguous (the tab's data did not visibly change, so it may be a late signal
--     from an earlier query) is not trusted: after a quiet settleDelay the tab is queried once more, and only a
--     signal following that confirming query counts (TB-BM-01).
--   * A change signal for a tab already read invalidates that read: the tab is queued again, at most
--     maxChangeRetries times, then marked unstable and the snapshot stable=false (TB-BM-03). An 'uncertain'
--     event (the BankPort can no longer verify a tab it read) also makes the snapshot stable=false.
--   * The bank closing aborts the scan; nothing is saved, so the last complete snapshot is untouched (TB-BM-04).
--   * Without guild bank capability the scan refuses to start and touches nothing (TB-DM-04).
--   * Tab count and capacity come from the BankPort; nothing is hardcoded.
local _, ns = ...

local ScanCoordinator = {}
ScanCoordinator.__index = ScanCoordinator

ScanCoordinator.DEFAULTS = {
  tabTimeout = 5, -- seconds to wait for a tab's update signal
  maxAttempts = 3, -- queries per tab before it is unknown
  retryDelay = 1, -- seconds between attempts
  settleDelay = 0.3, -- quiet seconds after a signal before reading
  maxSettleResets = 20, -- signals while settling before the tab counts as changing under us
  maxChangeRetries = 2, -- re-reads of a tab invalidated by a change before it is unstable
}

local floor = math.floor

-- deps: bank (BankPort), clock (ClockPort), capabilities (CapabilityPort), store (StorePort), addonVersion,
-- random (optional, () -> 0..65535), options (optional overrides of DEFAULTS).
function ScanCoordinator.new(deps)
  local self = setmetatable({}, ScanCoordinator)
  self.bank = ns.Ports.assert("BankPort", deps.bank)
  self.clock = ns.Ports.assert("ClockPort", deps.clock)
  self.capabilities = ns.Ports.assert("CapabilityPort", deps.capabilities)
  self.store = ns.Ports.assert("StorePort", deps.store)
  self.addonVersion = deps.addonVersion or "0.0.0"
  self.random = deps.random or function()
    return math.random(0, 65535)
  end
  self.options = {}
  for k, v in pairs(ScanCoordinator.DEFAULTS) do
    self.options[k] = v
  end
  for k, v in pairs(deps.options or {}) do
    self.options[k] = v
  end
  self.listeners = {}
  self.state = "idle"
  return self
end

function ScanCoordinator:now()
  return floor(self.clock:now())
end

function ScanCoordinator:subscribe(listener)
  self.listeners[#self.listeners + 1] = listener
end

function ScanCoordinator:status()
  local scan = self.scan
  local status = {
    state = self.state,
    reason = self.reason,
    issues = self.issues,
    snapshotId = self.lastSnapshotId,
  }
  if scan then
    local done = 0
    for _ in pairs(scan.results) do
      done = done + 1
    end
    status.tabsDone = done
    status.tabsTotal = #scan.order
    status.tab = scan.current and scan.current.index or nil
  end
  return status
end

function ScanCoordinator:setState(state, reason, issues)
  self.state, self.reason, self.issues = state, reason, issues
  self:notify()
end

function ScanCoordinator:notify()
  local status = self:status()
  for i = 1, #self.listeners do
    self.listeners[i](status)
  end
end

function ScanCoordinator:start()
  if self.state == "scanning" then
    return false, "busy"
  end
  if not self.bank:supportsGuildBank() then
    self:setState("unsupported", "unsupported")
    return false, "unsupported"
  end
  if not self.bank:isOpen() then
    return false, "bank_closed"
  end
  local identity = self.bank:getSourceIdentity() or {}
  if type(identity.guild) ~= "string" or identity.guild == "" then
    return false, "no_guild"
  end
  local now = self:now()
  local scan = { identity = identity, startedAt = now, order = {}, info = {}, queue = {}, results = {}, changes = {} }
  local tabs = self.bank:listTabs() or {}
  for i = 1, #tabs do
    local tab = tabs[i]
    local capacity = tonumber(self.bank:getCapacity(tab.index)) or 0
    local entry = { index = tab.index, name = tab.name or "", capacity = floor(capacity) }
    scan.order[#scan.order + 1] = tab.index
    scan.info[tab.index] = entry
    if tab.viewable == false or entry.capacity < 1 then
      scan.results[tab.index] = ns.Tab.unknown(entry.index, entry.name, entry.capacity, now)
    else
      scan.queue[#scan.queue + 1] = tab.index
    end
  end
  table.sort(scan.order)
  self.scan = scan
  self.unsubscribe = self.bank:subscribeToUpdates(function(event)
    self:onBankEvent(scan, event)
  end)
  self:setState("scanning")
  self:nextTab(scan)
  return true
end

function ScanCoordinator:abort(reason)
  if self.state ~= "scanning" then
    return false, "not_scanning"
  end
  self:stop(self.scan)
  self:setState("aborted", reason or "user")
  return true
end

-- Ends the scan's subscription and timers; a no-op for a scan that is no longer current.
function ScanCoordinator:stop(scan)
  if scan.current then
    self:cancelTimers(scan.current)
  end
  scan.current = nil
  if self.unsubscribe then
    self.unsubscribe()
    self.unsubscribe = nil
  end
  if self.scan == scan then
    self.scan = nil
  end
end

function ScanCoordinator:cancelTimers(attempt)
  if attempt.cancelTimer then
    attempt.cancelTimer()
    attempt.cancelTimer = nil
  end
end

-- Schedules fn for this attempt, cancelling the attempt's previous timer; fn only runs while the attempt is live.
function ScanCoordinator:arm(scan, attempt, delay, fn)
  self:cancelTimers(attempt)
  attempt.cancelTimer = self.clock:schedule(delay, function()
    attempt.cancelTimer = nil
    if self.scan == scan and scan.current == attempt then
      fn()
    end
  end)
end

function ScanCoordinator:nextTab(scan)
  if self.scan ~= scan then
    return
  end
  if #scan.queue == 0 then
    return self:finish(scan)
  end
  local index = table.remove(scan.queue, 1)
  scan.current = { index = index, failures = 0 }
  self:notify()
  self:query(scan, scan.current)
end

function ScanCoordinator:query(scan, attempt)
  attempt.phase = "awaiting"
  attempt.settleResets = 0
  -- The timeout is armed before the query so a signal raised during queryTab is not lost.
  self:arm(scan, attempt, self.options.tabTimeout, function()
    self:fail(scan, attempt, "timeout")
  end)
  local ok, reason = self.bank:queryTab(attempt.index)
  if not ok and self.scan == scan and scan.current == attempt and attempt.phase == "awaiting" then
    self:fail(scan, attempt, reason or "query_failed")
  end
end

function ScanCoordinator:onBankEvent(scan, event)
  if self.scan ~= scan or type(event) ~= "table" then
    return
  end
  if event.type == "closed" then
    self:abort("bank_closed")
    return
  end
  if event.type == "uncertain" then
    local result = event.tab and scan.results[event.tab]
    if result and result.status == ns.Tab.OBSERVED then
      scan.uncertain = true
    end
    return
  end
  if event.type ~= "changed" then
    return
  end
  local attempt = scan.current
  if attempt and (event.tab == nil or event.tab == attempt.index) then
    self:onSignal(scan, attempt, event.ambiguous == true)
  elseif event.tab ~= nil then
    local result = scan.results[event.tab]
    if result and result.status == ns.Tab.OBSERVED then
      self:invalidate(scan, event.tab)
    end
  end
end

-- An update signal for the tab in flight. An ambiguous one before the confirming query only starts that query.
function ScanCoordinator:onSignal(scan, attempt, ambiguous)
  if (attempt.phase == "awaiting" or attempt.phase == "confirming") and ambiguous and not attempt.confirmed then
    if attempt.phase == "confirming" then
      attempt.settleResets = attempt.settleResets + 1
      if attempt.settleResets > self.options.maxSettleResets then
        self:invalidate(scan, attempt.index)
        return
      end
    end
    attempt.phase = "confirming"
    self:arm(scan, attempt, self.options.settleDelay, function()
      attempt.confirmed = true
      self:query(scan, attempt)
    end)
    return
  end
  if attempt.phase == "awaiting" or attempt.phase == "confirming" then
    attempt.phase = "settling"
    attempt.settleResets = 0
  elseif attempt.phase == "settling" then
    attempt.settleResets = attempt.settleResets + 1
    if attempt.settleResets > self.options.maxSettleResets then
      self:invalidate(scan, attempt.index)
      return
    end
  else
    return -- waiting to retry: the next query brings its own signal
  end
  self:arm(scan, attempt, self.options.settleDelay, function()
    self:read(scan, attempt)
  end)
end

function ScanCoordinator:read(scan, attempt)
  attempt.phase = "reading"
  local info = scan.info[attempt.index]
  local slots, reason = self.bank:readTabSlots(attempt.index)
  if type(slots) ~= "table" then
    return self:fail(scan, attempt, reason or "read_failed")
  end
  local seen = {}
  for i = 1, #slots do
    local ok, why = ns.Slot.check(slots[i], info.capacity)
    if not ok then
      return self:fail(scan, attempt, why)
    end
    if seen[slots[i].slot] then
      return self:fail(scan, attempt, "slot " .. slots[i].slot .. " read twice")
    end
    seen[slots[i].slot] = true
  end
  scan.results[attempt.index] = ns.Tab.observed(info.index, info.name, info.capacity, self:now(), slots)
  scan.current = nil
  self:nextTab(scan)
end

function ScanCoordinator:fail(scan, attempt, reason)
  self:cancelTimers(attempt)
  attempt.failures = attempt.failures + 1
  attempt.lastError = reason
  if attempt.failures >= self.options.maxAttempts then
    local info = scan.info[attempt.index]
    scan.results[attempt.index] = ns.Tab.unknown(info.index, info.name, info.capacity, self:now())
    scan.current = nil
    return self:nextTab(scan)
  end
  attempt.phase = "retrying"
  self:arm(scan, attempt, self.options.retryDelay, function()
    self:query(scan, attempt)
  end)
end

local function removeValue(list, value)
  for i = #list, 1, -1 do
    if list[i] == value then
      table.remove(list, i)
    end
  end
end

local function contains(list, value)
  for i = 1, #list do
    if list[i] == value then
      return true
    end
  end
  return false
end

-- Bank contents changed for a tab during the scan: read it again, or give up on it as unstable (TB-BM-03).
function ScanCoordinator:invalidate(scan, index)
  scan.changes[index] = (scan.changes[index] or 0) + 1
  scan.results[index] = nil
  local attempt = scan.current
  local inFlight = attempt ~= nil and attempt.index == index
  if scan.changes[index] > self.options.maxChangeRetries then
    local info = scan.info[index]
    scan.results[index] = ns.Tab.unstable(info.index, info.name, info.capacity, self:now())
    removeValue(scan.queue, index)
    if inFlight then
      self:cancelTimers(attempt)
      scan.current = nil
      self:nextTab(scan)
    end
    return
  end
  if inFlight then
    self:query(scan, attempt)
  elseif not contains(scan.queue, index) then
    scan.queue[#scan.queue + 1] = index
  end
end

function ScanCoordinator:finish(scan)
  self:stop(scan)
  local now = self:now()
  local identity = scan.identity
  local profile = self.capabilities:getProfile() or {}
  local tabs, stable = {}, not scan.uncertain
  for i = 1, #scan.order do
    local tab = scan.results[scan.order[i]]
    tabs[#tabs + 1] = tab
    if tab.status == ns.Tab.UNSTABLE then
      stable = false
    end
  end
  local uploaderRealm = identity.uploaderRealm or identity.realm
  local snapshot = ns.Snapshot.build({
    snapshotId = ns.Snapshot.makeId(uploaderRealm, identity.uploaderName, scan.startedAt, self.random()),
    addonVersion = self.addonVersion,
    client = { flavour = profile.flavour, build = profile.build, interface = profile.interface },
    source = { guild = identity.guild, realm = identity.realm, region = identity.region },
    uploader = { name = identity.uploaderName, realm = uploaderRealm },
    capturedAt = scan.startedAt,
    completedAt = now,
    stable = stable,
    money = self.bank.getMoney and self.bank:getMoney() or nil,
    tabs = tabs,
  })
  local ok, issues = ns.Validator.validate(snapshot, now)
  if not ok then
    self:setState("failed", "invalid_snapshot", issues)
    return
  end
  self.store:saveSnapshot(snapshot)
  self.lastSnapshotId = snapshot.snapshotId
  self.lastSnapshot = snapshot
  self:setState("complete", stable and "stable" or "unstable")
end

ns.ScanCoordinator = ScanCoordinator
