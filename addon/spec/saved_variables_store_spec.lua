-- SavedVariablesStore (StorePort in WoW): last complete snapshot, bounded history of 5, preferences. An aborted
-- scan never saves, so the previous snapshot survives (TB-BM-04).
local Loader = require("spec.helpers.loader")
local FakeWow = require("spec.helpers.fake_wow")

describe("SavedVariablesStore (TB-BM-04)", function()
  local ns, db, store

  local function snap(n)
    return { snapshotId = "snapshot-" .. n, tabs = ns.JsonEncoder.array({}) }
  end

  before_each(function()
    ns = Loader.withAdapters(FakeWow.new(), { "adapters/wow/SavedVariablesStore.lua" })
    db = {}
    store = ns.SavedVariablesStore.new(db)
  end)

  it("implements StorePort and starts empty", function()
    assert.is_true((ns.Ports.check("StorePort", store)))
    assert.is_nil(store:loadLastSnapshot())
    assert.are.same({}, store:history())
  end)

  it("keeps the last snapshot and at most five in history, newest first", function()
    for n = 1, 7 do
      store:saveSnapshot(snap(n))
    end
    assert.are.equal("snapshot-7", store:loadLastSnapshot().snapshotId)
    assert.are.equal(5, #store:history())
    assert.are.equal("snapshot-7", store:history()[1].snapshotId)
    assert.are.equal("snapshot-3", store:history()[5].snapshotId)
    assert.are.equal(db.lastSnapshot, store:loadLastSnapshot())
  end)

  it("stores plain copies, as SavedVariables would", function()
    local s = snap(1)
    store:saveSnapshot(s)
    assert.are_not.equal(s, store:loadLastSnapshot())
    assert.is_nil(getmetatable(store:loadLastSnapshot().tabs))
  end)

  it("reopens an existing table, trimming an over-long history", function()
    local existing = { lastSnapshot = snap(9), history = {}, preferences = { panel = "shown" } }
    for n = 1, 8 do
      existing.history[n] = snap(n)
    end
    store = ns.SavedVariablesStore.new(existing)
    assert.are.equal("snapshot-9", store:loadLastSnapshot().snapshotId)
    assert.are.equal(5, #store:history())
    assert.are.equal("shown", store:getPreference("panel"))
  end)

  it("keeps preferences", function()
    store:setPreference("exportPart", 2)
    assert.are.equal(2, store:getPreference("exportPart"))
    assert.are.equal(2, db.preferences.exportPart)
  end)
end)
