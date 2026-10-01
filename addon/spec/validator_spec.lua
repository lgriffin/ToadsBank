-- Validator mirrors contracts/schema/snapshot.v1.json and its cross-field rules, so the export refuses what the
-- service would reject (TB-DM-03, TB-BM-02: unknown and unstable tabs carry no slots).
local Loader = require("spec.helpers.loader")
local Fixtures = require("spec.helpers.fixtures")

local NOW = 1790800000

describe("Validator (TB-DM-03)", function()
  local ns, V, snap

  local function messages(value)
    local ok, issues = V.validate(value, NOW)
    assert.is_false(ok)
    return V.describe(issues) .. " (" .. #issues .. ")"
  end

  before_each(function()
    ns = Loader.core()
    V = ns.Validator
    snap = Fixtures.goldenSnapshot(ns.JsonEncoder.array)
  end)

  it("accepts the golden snapshot, marked or plain", function()
    assert.is_true((V.validate(snap, NOW)))
    assert.is_true((V.validate(ns.Snapshot.copy(snap), NOW)))
  end)

  it("accepts a snapshot with no money and no tabs", function()
    snap.money = nil
    snap.tabs = {}
    assert.is_true((V.validate(snap, NOW)))
  end)

  it("rejects unknown and missing top-level fields", function()
    snap.extra = 1
    assert.matches("/extra is not allowed", messages(snap))
    snap.extra = nil
    snap.stable = nil
    assert.matches("/stable is required", messages(snap))
  end)

  it("checks the constants and the snapshot id pattern", function()
    snap.schemaVersion = 2
    assert.matches("/schemaVersion", messages(snap))
    snap.schemaVersion = 1
    snap.snapshotId = "short"
    assert.matches("/snapshotId", messages(snap))
    snap.snapshotId = "has_underscore-1234"
    assert.matches("/snapshotId", messages(snap))
    snap.snapshotId = string.rep("a", 49)
    assert.matches("/snapshotId", messages(snap))
  end)

  it("checks string lengths in characters", function()
    snap.uploader.name = string.rep("\195\182", 24)
    assert.is_true((V.validate(snap, NOW)))
    snap.uploader.name = string.rep("\195\182", 25)
    assert.matches("/uploader/name", messages(snap))
  end)

  it("rejects duplicate tab indices", function()
    snap.tabs[3].index = 2
    assert.matches("duplicates tab 2", messages(snap))
  end)

  it("rejects duplicate slots and slots beyond the tab's capacity", function()
    local slots = snap.tabs[2].slots
    slots[#slots + 1] = { slot = 5, itemId = 1, count = 1 }
    assert.matches("duplicates slot 5", messages(snap))
    slots[#slots] = nil
    snap.tabs[2].capacity = 97
    assert.matches("/tabs/1/slots/2/slot must be an integer from 1 to 97", messages(snap))
  end)

  it("rejects slots on an unknown or unstable tab (TB-BM-02)", function()
    snap.tabs[3].slots[1] = { slot = 1, itemId = 1, count = 1 }
    assert.matches("must be empty unless the tab was observed", messages(snap))
  end)

  it("rejects bad counts, item IDs and statuses", function()
    snap.tabs[1].slots[1].count = 0
    assert.matches("/count", messages(snap))
    snap.tabs[1].slots[1].count = 1
    snap.tabs[1].slots[1].itemId = 1.5
    assert.matches("/itemId", messages(snap))
    snap.tabs[1].slots[1].itemId = 1
    snap.tabs[1].status = "empty"
    assert.matches("must be observed, unknown or unstable", messages(snap))
  end)

  it("rejects completedAt before capturedAt and timestamps in the future", function()
    snap.completedAt = snap.capturedAt - 1
    assert.matches("must not be before capturedAt", messages(snap))
    snap.completedAt = NOW + 301
    assert.matches("is in the future", messages(snap))
    snap.completedAt = NOW + 300
    snap.tabs[1].observedAt = NOW + 301
    assert.matches("/tabs/0/observedAt is in the future", messages(snap))
  end)

  it("rejects more than 16 tabs and lists with holes", function()
    local tabs = {}
    for i = 1, 17 do
      tabs[i] = { index = 1, name = "", status = "unknown", capacity = 0, observedAt = 0, slots = {} }
    end
    snap.tabs = tabs
    assert.matches("at most 16 tabs", messages(snap))
    snap.tabs = { [1] = snap.tabs[1], [3] = snap.tabs[3] }
    assert.matches("/tabs must be an array", messages(snap))
  end)
end)
