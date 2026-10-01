-- ScanCoordinator against FakeBank and a manual clock: each scan rule the core owns (TB-BM-01..04, TB-DM-04),
-- all on plain Lua with no WoW client (TB-DM-02).
local Loader = require("spec.helpers.loader")
local FakeBank = require("spec.fakes.FakeBank")
local ManualClock = require("spec.fakes.ManualClock")
local MemoryStore = require("spec.fakes.MemoryStore")
local FixedCapabilities = require("spec.fakes.FixedCapabilities")

local function item(slot, itemId, count)
  local link = "|cffffffff|Hitem:" .. itemId .. "::::::::70:::::|h[X]|h|r"
  return { slot = slot, itemId = itemId, count = count, link = link }
end

-- The bank's query and read calls, in order.
local function trace(bank, from)
  local out = {}
  for _, call in ipairs(bank.calls) do
    if call:find("^query:") or call:find("^read:") then
      out[#out + 1] = call
    end
  end
  return table.concat(out, " ", from or 1)
end

local function calls(bank, prefix)
  local out = {}
  for _, call in ipairs(bank.calls) do
    if call:find(prefix, 1, true) == 1 then
      out[#out + 1] = call
    end
  end
  return table.concat(out, " ")
end

describe("ScanCoordinator", function()
  local ns, clock, bank, store, scanner

  local function setup(tabs, config, options)
    config = config or {}
    config.tabs = tabs
    clock = ManualClock.new(1790799000)
    bank = FakeBank.new(clock, config)
    store = MemoryStore.new()
    scanner = ns.ScanCoordinator.new({
      bank = bank,
      clock = clock,
      capabilities = FixedCapabilities.new(),
      store = store,
      addonVersion = "1.2.3",
      random = function() return 0xa1b2 end,
      options = options,
    })
  end

  local function tab(slots, extra)
    local t = { slots = slots or {} }
    for k, v in pairs(extra or {}) do
      t[k] = v
    end
    return t
  end

  before_each(function()
    ns = Loader.core()
  end)

  describe("TB-BM-01 one tab in flight, read only after its own update signal", function()
    it("queries each tab in turn and reads it only after that tab's signal", function()
      setup({ tab({ item(1, 22832, 5) }), tab({ item(3, 22829, 2) }), tab({}) })
      assert.is_true((scanner:start()))
      assert.are.equal("query:1", calls(bank, "query:"))
      assert.are.equal("", calls(bank, "read:"))
      clock:advance(0.9)
      assert.are.equal("", calls(bank, "read:"), "no read before the signal")
      clock:advance(0.5)
      assert.are.equal("read:1", calls(bank, "read:"))
      assert.are.equal("query:1 query:2", calls(bank, "query:"))
      clock:advance(10)
      assert.are.equal("query:1 read:1 query:2 read:2 query:3 read:3", trace(bank))
      assert.are.equal("complete", scanner:status().state)
    end)

    it("does not start on a tab's read when another tab signals", function()
      setup({ tab({ item(1, 22832, 5) }, { silent = 1 }), tab({}) })
      scanner:start()
      bank:emit({ type = "changed", tab = 2 })
      clock:advance(1)
      assert.are.equal("", calls(bank, "read:"))
      assert.are.equal("query:1", calls(bank, "query:"))
    end)

    it("settles several signals for one query into a single read", function()
      setup({ tab({ item(1, 22832, 5) }, { echoes = 3 }) })
      scanner:start()
      clock:advance(10)
      assert.are.equal(1, bank:count("read:1"))
      assert.are.equal("observed", store.last.tabs[1].status)
    end)

    it("takes the tab count and each tab's capacity from the bank, never a constant", function()
      local tabs = {}
      for i = 1, 9 do
        tabs[i] = tab({ item(i, 1000 + i, i) }, { capacity = 10 + i })
      end
      setup(tabs)
      scanner:start()
      clock:advance(60)
      assert.are.equal(9, #store.last.tabs)
      for i = 1, 9 do
        assert.are.equal(10 + i, store.last.tabs[i].capacity)
      end
    end)

    it("captures slot, item ID, count and link together", function()
      setup({ tab({ item(7, 22854, 15), { slot = 2, itemId = 13444, count = 3 } }) })
      scanner:start()
      clock:advance(5)
      assert.are.same({
        { slot = 2, itemId = 13444, count = 3 },
        { slot = 7, itemId = 22854, count = 15, link = item(7, 22854, 15).link },
      }, store.last.tabs[1].slots)
    end)

    it("builds a snapshot that matches schema v1", function()
      setup({ tab({ item(1, 22832, 5) }), tab({}, { viewable = false }) }, { money = 123456 })
      scanner:start()
      clock:advance(5)
      local snap = store.last
      assert.is_true((ns.Validator.validate(snap, clock:now())))
      assert.are.equal("toadsbank.snapshot", snap.schema)
      assert.are.equal(1, snap.schemaVersion)
      assert.are.equal("spineshatter-bankalt-1790799000-a1b2", snap.snapshotId)
      assert.are.same({ version = "1.2.3" }, snap.addon)
      assert.are.same({ flavour = "tbc", build = "2.5.5.65000", interface = 20505 }, snap.client)
      assert.are.same({ kind = "guildBank", guild = "Toads", realm = "Spineshatter", region = "EU" }, snap.source)
      assert.are.same({ name = "Bankalt", realm = "Spineshatter" }, snap.uploader)
      assert.are.equal(1790799000, snap.capturedAt)
      assert.are.equal(1790799001, snap.completedAt)
      assert.are.equal(1790799001, snap.tabs[1].observedAt)
      assert.is_true(snap.stable)
      assert.are.equal(123456, snap.money)
      assert.are.equal("complete", scanner:status().state)
      assert.are.equal(snap.snapshotId, scanner:status().snapshotId)
    end)

    it("refuses a second start while scanning and scans again afterwards", function()
      setup({ tab({ item(1, 22832, 5) }) })
      scanner:start()
      local ok, reason = scanner:start()
      assert.is_false(ok)
      assert.are.equal("busy", reason)
      clock:advance(5)
      assert.is_true((scanner:start()))
      clock:advance(5)
      assert.are.equal(2, store.saves)
    end)

    it("refuses to scan without a guild", function()
      setup({ tab({}) }, { identity = { realm = "Spineshatter", uploaderName = "Solo" } })
      local ok, reason = scanner:start()
      assert.is_false(ok)
      assert.are.equal("no_guild", reason)
    end)
  end)

  describe("TB-BM-02 a tab that is inaccessible or times out is unknown, never empty", function()
    it("marks a non-viewable tab unknown without querying it", function()
      setup({ tab({ item(1, 1, 1) }, { viewable = false }), tab({ item(1, 2, 1) }) })
      scanner:start()
      clock:advance(5)
      assert.are.equal("query:2", calls(bank, "query:"))
      assert.are.equal("unknown", store.last.tabs[1].status)
      assert.are.same({}, store.last.tabs[1].slots)
      assert.are.equal("observed", store.last.tabs[2].status)
    end)

    it("retries a tab that does not answer, a bounded number of times, then marks it unknown", function()
      setup({ tab({ item(1, 1, 1) }, { silent = 100 }), tab({ item(1, 2, 1) }) })
      scanner:start()
      clock:advance(60)
      assert.are.equal(3, bank:count("query:1"))
      assert.are.equal(0, bank:count("read:1"))
      assert.are.equal("unknown", store.last.tabs[1].status)
      assert.are.same({}, store.last.tabs[1].slots)
      assert.are.equal("observed", store.last.tabs[2].status)
      assert.is_true(store.last.stable)
    end)

    it("reads a tab that answers on a retry", function()
      setup({ tab({ item(1, 1, 1) }, { silent = 1 }) })
      scanner:start()
      clock:advance(5)
      assert.are.equal(1, bank:count("query:1"), "waits out the timeout before retrying")
      clock:advance(10)
      assert.are.equal(2, bank:count("query:1"))
      assert.are.equal("observed", store.last.tabs[1].status)
    end)

    it("retries a query the client refused", function()
      setup({ tab({ item(1, 1, 1) }, { queryErrors = 1 }) })
      scanner:start()
      clock:advance(5)
      assert.are.equal(2, bank:count("query:1"))
      assert.are.equal("observed", store.last.tabs[1].status)
    end)

    it("retries a read that came back incomplete, then gives up as unknown", function()
      setup({ tab({ item(1, 1, 1) }, { readErrors = 1 }), tab({ item(1, 2, 1) }, { readErrors = 100 }) })
      scanner:start()
      clock:advance(60)
      assert.are.equal("observed", store.last.tabs[1].status)
      assert.are.equal(3, bank:count("read:2"))
      assert.are.equal("unknown", store.last.tabs[2].status)
    end)

    it("treats impossible slot data as a failed read, not as contents", function()
      setup({ tab({ item(99, 1, 1) }, { capacity = 98 }) })
      scanner:start()
      clock:advance(60)
      assert.are.equal("unknown", store.last.tabs[1].status)
      assert.are.same({}, store.last.tabs[1].slots)
    end)
  end)

  describe("TB-BM-03 a change during the scan retries the tab or marks the scan unstable", function()
    it("re-reads a tab that changed after it was read", function()
      local tabs = { tab({ item(1, 1, 1) }), tab({ item(1, 2, 1) }) }
      tabs[2].onQuery = function(b, attempt)
        if attempt == 1 then
          b:change(1, { item(1, 1, 1), item(2, 3, 4) })
        end
      end
      setup(tabs)
      scanner:start()
      clock:advance(60)
      assert.are.equal(2, bank:count("read:1"))
      assert.are.equal(2, #store.last.tabs[1].slots)
      assert.are.equal("observed", store.last.tabs[1].status)
      assert.is_true(store.last.stable)
    end)

    it("marks a tab unstable and the snapshot stable=false when it keeps changing", function()
      -- Someone keeps moving items in tab 1: its signals never settle, so every attempt is invalidated.
      setup({ tab({ item(1, 1, 1) }, { echoes = 60 }), tab({ item(1, 2, 1) }) })
      scanner:start()
      clock:advance(120)
      assert.are.equal("complete", scanner:status().state)
      assert.are.equal(3, bank:count("query:1"), "the first query and two retries")
      assert.are.equal(0, bank:count("read:1"))
      assert.are.equal("unstable", store.last.tabs[1].status)
      assert.are.same({}, store.last.tabs[1].slots)
      assert.are.equal("observed", store.last.tabs[2].status)
      assert.is_false(store.last.stable)
      assert.are.equal("unstable", scanner:status().reason)
      assert.is_true((ns.Validator.validate(store.last, clock:now())))
    end)

    it("marks a tab unstable when a change after its read exceeds the retries", function()
      local tabs = { tab({ item(1, 1, 1) }), tab({ item(1, 2, 1) }) }
      tabs[2].onQuery = function(b)
        b:change(1, { item(1, 1, 7) })
      end
      setup(tabs, nil, { maxChangeRetries = 0 })
      scanner:start()
      clock:advance(60)
      assert.are.equal(1, bank:count("read:1"))
      assert.are.equal("unstable", store.last.tabs[1].status)
      assert.are.same({}, store.last.tabs[1].slots)
      assert.is_false(store.last.stable)
    end)

    it("re-queries the tab in flight when it keeps signalling while settling", function()
      setup({ tab({ item(1, 1, 1) }) }, nil, { maxSettleResets = 1 })
      scanner:start()
      clock:advance(1.1)
      bank:emit({ type = "changed", tab = 1 })
      bank:emit({ type = "changed", tab = 1 })
      assert.are.equal(2, bank:count("query:1"))
      clock:advance(10)
      assert.are.equal(1, bank:count("read:1"))
      assert.are.equal("observed", store.last.tabs[1].status)
    end)

    it("ignores changes to a tab it has not reached yet", function()
      setup({ tab({ item(1, 1, 1) }), tab({ item(1, 2, 1) }) })
      scanner:start()
      bank:change(2, { item(1, 2, 9) })
      clock:advance(10)
      assert.are.equal(1, bank:count("query:2"))
      assert.are.equal(9, store.last.tabs[2].slots[1].count)
      assert.is_true(store.last.stable)
    end)
  end)

  describe("TB-BM-04 the bank closing aborts and keeps the previous complete snapshot", function()
    it("aborts mid-scan, saves nothing and queries nothing more", function()
      setup({ tab({ item(1, 1, 1) }), tab({ item(1, 2, 1) }), tab({ item(1, 3, 1) }) })
      scanner:start()
      clock:advance(5)
      local previous = store.last
      assert.is_not_nil(previous)
      local before = #bank.calls
      scanner:start()
      clock:advance(1.5)
      bank:close()
      clock:advance(60)
      assert.are.equal("aborted", scanner:status().state)
      assert.are.equal("bank_closed", scanner:status().reason)
      assert.are.equal(previous, store.last)
      assert.are.equal(1, store.saves)
      local after = {}
      for i = before + 1, #bank.calls do
        after[#after + 1] = bank.calls[i]
      end
      assert.are.equal("supportsGuildBank listTabs query:1 read:1 query:2", table.concat(after, " "))
      assert.are.equal(0, #bank.listeners)
    end)

    it("refuses to start with the bank closed", function()
      setup({ tab({}) }, { open = false })
      local ok, reason = scanner:start()
      assert.is_false(ok)
      assert.are.equal("bank_closed", reason)
      assert.are.equal("", calls(bank, "query:"))
    end)

    it("a player's abort also keeps the previous snapshot", function()
      setup({ tab({ item(1, 1, 1) }) })
      scanner:start()
      clock:advance(5)
      local previous = store.last
      scanner:start()
      assert.is_true((scanner:abort()))
      clock:advance(60)
      assert.are.equal("aborted", scanner:status().state)
      assert.are.equal("user", scanner:status().reason)
      assert.are.equal(previous, store.last)
      assert.are.equal(0, clock:pending())
      local ok, reason = scanner:abort()
      assert.is_false(ok)
      assert.are.equal("not_scanning", reason)
    end)
  end)

  describe("TB-DM-04 without guild bank capability the source is unsupported and nothing is scanned", function()
    it("reports unsupported and touches no tab", function()
      setup({ tab({ item(1, 1, 1) }) }, { supported = false })
      local ok, reason = scanner:start()
      assert.is_false(ok)
      assert.are.equal("unsupported", reason)
      assert.are.equal("unsupported", scanner:status().state)
      assert.are.equal("supportsGuildBank", table.concat(bank.calls, " "))
      clock:advance(60)
      assert.is_nil(store.last)
    end)
  end)

  describe("ports", function()
    it("refuses adapters that do not implement a port", function()
      assert.has_error(function()
        ns.ScanCoordinator.new({ bank = {}, clock = ManualClock.new(), capabilities = FixedCapabilities.new(),
          store = MemoryStore.new() })
      end)
      local ok, missing = ns.Ports.check("BankPort", { isOpen = function() end })
      assert.is_false(ok)
      assert.matches("queryTab", table.concat(missing, ","))
      assert.is_true((ns.Ports.check("BankPort", FakeBank.new(ManualClock.new()))))
      assert.is_true((ns.Ports.check("StorePort", MemoryStore.new())))
    end)
  end)
end)
