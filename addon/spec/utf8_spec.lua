-- UTF-8 as the service reads it (TB-DM-03): its fatal decoder rejects malformed sequences, and it measures strings
-- in UTF-16 code units, so a supplementary-plane character counts 2. TB-DM-02: plain Lua.
local Loader = require("spec.helpers.loader")
local Fixtures = require("spec.helpers.fixtures")
local purebit = require("spec.helpers.purebit")
local ManualClock = require("spec.fakes.ManualClock")
local MemoryStore = require("spec.fakes.MemoryStore")

local FROG = "\240\159\144\184" -- U+1F438, 4 bytes, 2 UTF-16 units
local E_ACUTE = "\195\169" -- U+00E9, 2 bytes, 1 unit
local EURO = "\226\130\172" -- U+20AC, 3 bytes, 1 unit

describe("Utf8 (TB-DM-03)", function()
  local ns, U

  before_each(function()
    ns = Loader.core()
    U = ns.Utf8
  end)

  it("counts UTF-16 code units", function()
    assert.are.equal(0, U.units(""))
    assert.are.equal(3, U.units("a" .. E_ACUTE .. EURO))
    assert.are.equal(2, U.units(FROG))
    assert.are.equal(24, U.units(string.rep(FROG, 12)))
    assert.are.equal(ns.Snapshot.length(FROG .. "a"), 3)
  end)

  it("accepts well-formed sequences at the edges of each range", function()
    for _, s in ipairs({ "\0", "\127", "\194\128", "\223\191", "\224\160\128", "\237\159\191", "\238\128\128",
      "\239\191\191", "\240\144\128\128", "\244\143\191\191" }) do
      assert.is_true((U.isValid(s)))
    end
  end)

  it("rejects 0xFF, overlongs, surrogates, code points above U+10FFFF and truncated sequences", function()
    for _, s in ipairs({ "\255", "a\255b", "\192\175", "\193\191", "\224\159\191", "\237\160\128", "\237\191\191",
      "\240\143\191\191", "\244\144\128\128", "\245\128\128\128", "\128", "\226\130", "\240\159\144", "\194" }) do
      assert.is_false((U.isValid(s)))
    end
    local ok, at = U.isValid("ab\255")
    assert.is_false(ok)
    assert.are.equal(3, at)
  end)

  it("sanitizes malformed bytes to U+FFFD", function()
    assert.are.equal("a" .. U.REPLACEMENT .. "b", U.sanitize("a\255b"))
    assert.are.equal(U.REPLACEMENT .. U.REPLACEMENT, U.sanitize("\226\130"))
    assert.are.equal("ok", U.sanitize("ok"))
  end)

  it("truncates on units without splitting a sequence or a surrogate pair", function()
    assert.are.equal(string.rep(FROG, 12), U.truncate(string.rep(FROG, 13), 24))
    assert.are.equal("a", U.truncate("a" .. FROG, 2), "the frog needs 2 units and only 1 is left")
    assert.are.equal("a" .. FROG, U.truncate("a" .. FROG, 3))
    assert.are.equal("a" .. E_ACUTE, U.truncate("a" .. E_ACUTE .. EURO, 2))
    assert.are.equal("", U.truncate(FROG, 1))
    assert.is_true((U.isValid(U.truncate("ab\240\159\144", 10))), "a truncated input never leaves a partial sequence")
  end)

  it("Snapshot.build keeps strings well-formed and within the service's lengths", function()
    local snap = ns.Snapshot.build({
      snapshotId = "realm-name-1790799000-0001",
      addonVersion = "1.0.0",
      client = { flavour = "tbc", build = "2.5.5", interface = 20505 },
      source = { guild = "Toads\255", realm = "Realm", region = "EU" },
      uploader = { name = string.rep(FROG, 13), realm = "Realm" },
      capturedAt = 1790799000,
      completedAt = 1790799010,
      stable = true,
      tabs = { ns.Tab.unknown(1, "Tab" .. string.rep(FROG, 40), 98, 1790799010) },
    })
    assert.are.equal("Toads" .. U.REPLACEMENT, snap.source.guild)
    assert.are.equal(string.rep(FROG, 12), snap.uploader.name)
    assert.are.equal(63, U.units(snap.tabs[1].name), "a 31st frog would need units 64 and 65")
    assert.is_true((ns.Validator.validate(snap, 1790799010)))
  end)

  it("drops a malformed link from a slot", function()
    assert.is_nil(ns.Slot.new(1, 22832, 1, "|Hitem:22832|h[\255]|h").link)
  end)

  describe("refusing malformed UTF-8", function()
    local snap

    before_each(function()
      snap = Fixtures.goldenSnapshot(ns.JsonEncoder.array)
    end)

    it("the Validator rejects an invalid byte (0xFF) and counts lengths in UTF-16 units", function()
      snap.tabs[1].name = "P\255tions"
      local ok, issues = ns.Validator.validate(snap, 1790800000)
      assert.is_false(ok)
      assert.matches("/tabs/0/name is not valid UTF%-8", ns.Validator.describe(issues))
      snap.tabs[1].name = "ok"
      snap.uploader.name = string.rep(FROG, 12)
      assert.is_true((ns.Validator.validate(snap, 1790800000)))
      snap.uploader.name = string.rep(FROG, 12) .. "a"
      assert.is_false((ns.Validator.validate(snap, 1790800000)))
    end)

    it("the JSON encoder refuses it", function()
      assert.has_error(function() ns.JsonEncoder.encode({ name = "P\255tions" }) end)
      assert.has_error(function() ns.JsonEncoder.encode({ ["\237\160\128"] = 1 }) end)
    end)

    it("the export refuses it", function()
      local store = MemoryStore.new()
      snap.source.guild = "Toads\255"
      store:saveSnapshot(snap)
      local exporter = ns.ExportSnapshot.new({ store = store, clock = ManualClock.new(1790800000), bit = purebit })
      local result, reason = exporter:exportLatest()
      assert.is_nil(result)
      assert.are.equal("invalid_snapshot", reason)
    end)
  end)
end)
