-- ExportSnapshot (ExportUseCase): selectable parts of at most 1,800 characters (TB-BM-05), refusing invalid
-- snapshots; unknown tabs export as unknown with no slots, never as empty (TB-BM-02).
local Loader = require("spec.helpers.loader")
local Fixtures = require("spec.helpers.fixtures")
local ManualClock = require("spec.fakes.ManualClock")
local MemoryStore = require("spec.fakes.MemoryStore")
local purebit = require("spec.helpers.purebit")

describe("ExportSnapshot (TB-BM-05)", function()
  local ns, store, clock, exporter

  before_each(function()
    ns = Loader.core()
    store = MemoryStore.new()
    clock = ManualClock.new(1790800000)
    exporter = ns.ExportSnapshot.new({ store = store, clock = clock, bit = purebit })
  end)

  local function fullBank()
    local tabs = {}
    for t = 1, 16 do
      local slots = {}
      for s = 1, 98 do
        local itemId = 20000 + s * t
        local link = "|cff1eff00|Hitem:" .. itemId .. "::::::::70:::::|h[A Fairly Long Item Name " .. s .. "]|h|r"
        slots[s] = { slot = s, itemId = itemId, count = 1 + (s % 20), link = link }
      end
      tabs[t] = ns.Tab.observed(t, "Tab " .. t, 98, 1790799010, slots)
    end
    return ns.Snapshot.build({
      snapshotId = "spineshatter-bankalt-1790799000-ffff",
      addonVersion = "1.0.0",
      client = { flavour = "tbc", build = "2.5.5.65000", interface = 20505 },
      source = { guild = "Toads", realm = "Spineshatter", region = "EU" },
      uploader = { name = "Bankalt", realm = "Spineshatter" },
      capturedAt = 1790799000,
      completedAt = 1790799020,
      stable = true,
      tabs = tabs,
    })
  end

  it("says there is nothing to export before the first scan", function()
    local result, reason = exporter:exportLatest()
    assert.is_nil(result)
    assert.are.equal("no_snapshot", reason)
  end)

  it("exports the last snapshot as the golden parts", function()
    store:saveSnapshot(ns.Snapshot.copy(Fixtures.goldenSnapshot(ns.JsonEncoder.array)))
    local result = exporter:exportLatest()
    assert.are.equal(5, #result.parts)
    assert.are.equal(Fixtures.read("golden/parts.txt"), ns.ExportChunker.join(result.parts) .. "\n")
    assert.are.equal("942cca3e", result.crc32)
  end)

  it("cuts a full 16-tab bank into parts of at most 1,800 characters that rebuild the payload", function()
    local result = exporter:exportSnapshot(fullBank())
    assert.truthy(#result.parts > 10)
    local chunks = {}
    for n, part in ipairs(Fixtures.parseParts(ns.ExportChunker.join(result.parts))) do
      assert.truthy(#result.parts[n] <= 1800)
      assert.are.equal(n, part.n)
      assert.are.equal(result.crc32, part.crc32)
      chunks[n] = ns.Base64.decode(part.payload)
    end
    assert.are.equal(result.payload, table.concat(chunks))
    assert.are.equal(result.crc32, ns.Crc32.new(purebit).hex(result.payload))
  end)

  it("refuses an invalid snapshot", function()
    local snap = fullBank()
    snap.tabs[2].slots[1].slot = 99
    local result, reason, issues = exporter:exportSnapshot(snap)
    assert.is_nil(result)
    assert.are.equal("invalid_snapshot", reason)
    assert.matches("/tabs/1/slots/0/slot", ns.Validator.describe(issues))
  end)

  it("refuses a snapshot from the future", function()
    local snap = fullBank()
    clock = ManualClock.new(1790799020 - 400)
    exporter = ns.ExportSnapshot.new({ store = store, clock = clock, bit = purebit })
    local result, reason = exporter:exportSnapshot(snap)
    assert.is_nil(result)
    assert.are.equal("invalid_snapshot", reason)
  end)

  it("exports an unknown tab as unknown with an empty slot array (TB-BM-02)", function()
    local snap = fullBank()
    snap.tabs[3] = ns.Tab.unknown(3, "Officers", 98, 1790799020)
    local result = exporter:exportSnapshot(snap)
    local expected = '{"capacity":98,"index":3,"name":"Officers","observedAt":1790799020,'
      .. '"slots":%[%],"status":"unknown"}'
    assert.matches(expected, result.payload)
  end)
end)
