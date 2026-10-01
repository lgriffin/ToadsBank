-- BankPort fake with scripted per-tab behaviour. Each tab:
--   { name, capacity = 98, viewable = true, slots = { {slot, itemId, count, link}, ... },
--     delay = 1,            -- seconds from queryTab to the update signal
--     echoes = 1,           -- signals per query (WoW often fires GUILDBANKBAGSLOTS_CHANGED more than once)
--     silent = 0,           -- the first `silent` queries never signal (timeouts)
--     queryErrors = 0,      -- the first `queryErrors` queries return false, "query_failed"
--     readErrors = 0,       -- the first `readErrors` reads return nil, "link_pending"
--     ambiguous = 0,        -- the first `ambiguous` signals are flagged ambiguous (data did not visibly change)
--     onQuery = function(bank, attempt) end,  -- hook for mid-scan changes
--   }
-- Every call is logged in bank.calls ("query:1", "read:1", ...) so specs can assert ordering.
local FakeBank = {}
FakeBank.__index = FakeBank

function FakeBank.new(clock, config)
  config = config or {}
  local self = setmetatable({}, FakeBank)
  self.clock = clock
  self.tabs = config.tabs or {}
  self.open = config.open ~= false
  self.supported = config.supported ~= false
  self.money = config.money
  self.identity = config.identity
    or {
      guild = "Toads", realm = "Spineshatter", region = "EU", uploaderName = "Bankalt", uploaderRealm = "Spineshatter",
    }
  self.listeners = {}
  self.calls = {}
  self.queries, self.reads, self.signals = {}, {}, {}
  return self
end

function FakeBank:log(entry)
  self.calls[#self.calls + 1] = entry
end

function FakeBank:supportsGuildBank()
  self:log("supportsGuildBank")
  return self.supported
end

function FakeBank:isOpen()
  return self.open
end

function FakeBank:getSourceIdentity()
  return self.identity
end

function FakeBank:listTabs()
  self:log("listTabs")
  local out = {}
  for i, tab in ipairs(self.tabs) do
    out[i] = { index = i, name = tab.name or ("Tab " .. i), viewable = tab.viewable ~= false }
  end
  return out
end

function FakeBank:getCapacity(index)
  return self.tabs[index].capacity or 98
end

function FakeBank:getMoney()
  return self.money
end

function FakeBank:subscribeToUpdates(listener)
  self.listeners[#self.listeners + 1] = listener
  return function()
    for i = #self.listeners, 1, -1 do
      if self.listeners[i] == listener then
        table.remove(self.listeners, i)
      end
    end
  end
end

function FakeBank:emit(event)
  local copy = {}
  for i, l in ipairs(self.listeners) do
    copy[i] = l
  end
  for _, listener in ipairs(copy) do
    listener(event)
  end
end

function FakeBank:queryTab(index)
  self:log("query:" .. index)
  local tab = self.tabs[index]
  self.queries[index] = (self.queries[index] or 0) + 1
  local attempt = self.queries[index]
  if tab.onQuery then
    tab.onQuery(self, attempt)
  end
  if attempt <= (tab.queryErrors or 0) then
    return false, "query_failed"
  end
  if attempt <= (tab.silent or 0) then
    return true
  end
  local delay = tab.delay or 1
  for echo = 1, (tab.echoes or 1) do
    self.clock:schedule(delay + (echo - 1) * 0.1, function()
      if self.open then
        self.signals[index] = (self.signals[index] or 0) + 1
        self:emit({ type = "changed", tab = index, ambiguous = self.signals[index] <= (tab.ambiguous or 0) })
      end
    end)
  end
  return true
end

function FakeBank:readTabSlots(index)
  self:log("read:" .. index)
  local tab = self.tabs[index]
  self.reads[index] = (self.reads[index] or 0) + 1
  if self.reads[index] <= (tab.readErrors or 0) then
    return nil, "link_pending"
  end
  local out = {}
  for i, s in ipairs(tab.slots or {}) do
    out[i] = { slot = s.slot, itemId = s.itemId, count = s.count, link = s.link }
  end
  return out
end

-- Script helpers.
function FakeBank:close()
  self.open = false
  self:emit({ type = "closed" })
end

-- Someone moved items in tab `index`: new contents plus a change signal for that tab.
function FakeBank:change(index, slots)
  self.tabs[index].slots = slots
  self:emit({ type = "changed", tab = index })
end

function FakeBank:count(entry)
  local n = 0
  for _, call in ipairs(self.calls) do
    if call == entry then
      n = n + 1
    end
  end
  return n
end

return FakeBank
