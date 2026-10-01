-- Snapshot, Tab and Slot domain records (TB-DM-02: plain Lua, no WoW).
local Loader = require("spec.helpers.loader")

describe("Snapshot domain (TB-DM-02)", function()
  local ns

  before_each(function()
    ns = Loader.core()
  end)

  it("makes ids as lowercase realm-character-epoch-random within the contract pattern", function()
    local makeId = ns.Snapshot.makeId
    assert.are.equal("spineshatter-bankalt-1790799000-a1b2", makeId("Spineshatter", "Bankalt", 1790799000, 0xa1b2))
    assert.are.equal("livingflame-bnkalt-1790799000-000f", makeId("Living Flame", "B\195\164nkalt", 1790799000, 15))
    local long = ns.Snapshot.makeId(string.rep("Realm", 10), "Character", 1790799000, 65535)
    assert.truthy(#long <= 48)
    assert.matches("%-1790799000%-ffff$", long)
    assert.matches("^[A-Za-z0-9-]+$", long)
    assert.are.equal("toadsbank-1790799000-0000", ns.Snapshot.makeId("", "", 1790799000, 0))
  end)

  it("truncates on UTF-8 character boundaries", function()
    assert.are.equal("P\195\182t", ns.Snapshot.truncate("P\195\182tions", 3))
    assert.are.equal(7, ns.Snapshot.length("P\195\182tions"))
    assert.are.equal("abc", ns.Snapshot.truncate("abc", 64))
  end)

  it("parses item IDs from links and item strings", function()
    assert.are.equal(22832, ns.Slot.itemIdFromLink("|cffffffff|Hitem:22832::::::::70:::::|h[Super Mana Potion]|h|r"))
    assert.are.equal(13444, ns.Slot.itemIdFromLink("item:13444:0:0"))
    assert.is_nil(ns.Slot.itemIdFromLink("|Hspell:133|h"))
    assert.is_nil(ns.Slot.itemIdFromLink(nil))
  end)

  it("keeps links up to 512 bytes and drops longer ones", function()
    assert.are.equal("item:1", ns.Slot.new(1, 1, 1, "item:1").link)
    assert.is_nil(ns.Slot.new(1, 1, 1, string.rep("x", 513)).link)
  end)

  it("builds unknown and unstable tabs with no slots and observed tabs sorted by slot", function()
    assert.are.same({}, ns.Tab.unknown(1, "A", 98, 5).slots)
    assert.are.equal("unstable", ns.Tab.unstable(1, "A", 98, 5).status)
    local slots = { { slot = 9, itemId = 1, count = 1 }, { slot = 2, itemId = 3, count = 4 } }
    local tab = ns.Tab.observed(2, "B", 98, 5, slots)
    assert.are.equal(2, tab.slots[1].slot)
    assert.are.equal(9, tab.slots[2].slot)
  end)

  it("builds a snapshot within the schema's limits", function()
    local snap = ns.Snapshot.build({
      snapshotId = "realm-name-1790799000-0001",
      addonVersion = "",
      client = { flavour = "TBC Anniversary", build = "2.5.5.65000", interface = 20505 },
      source = { guild = string.rep("g", 70), realm = "Realm", region = "Europe-West" },
      uploader = { name = "Name", realm = "Realm" },
      capturedAt = 1790799000.4,
      completedAt = 1790799010,
      stable = true,
      money = -1,
      tabs = { ns.Tab.unknown(2, "B", 98, 1790799010), ns.Tab.unknown(1, "A", 98, 1790799010) },
    })
    assert.are.equal("tbcanniversary", snap.client.flavour)
    assert.are.equal("0.0.0", snap.addon.version)
    assert.are.equal(64, #snap.source.guild)
    assert.are.equal("Europe-W", snap.source.region)
    assert.are.equal(1790799000, snap.capturedAt)
    assert.is_nil(snap.money)
    assert.are.equal(1, snap.tabs[1].index)
    assert.is_true((ns.Validator.validate(snap, 1790799010)))
  end)
end)
