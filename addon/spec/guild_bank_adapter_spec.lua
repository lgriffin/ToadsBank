-- GuildBankAdapter (BankPort in WoW) on a fake classic guild bank API, and a whole scan through it: queries one tab
-- at a time and reads after GUILDBANKBAGSLOTS_CHANGED (TB-BM-01), unviewable tabs unknown (TB-BM-02), the window
-- closing aborts (TB-BM-04).
local Loader = require("spec.helpers.loader")
local FakeWow = require("spec.helpers.fake_wow")
local ManualClock = require("spec.fakes.ManualClock")
local MemoryStore = require("spec.fakes.MemoryStore")

local ADAPTERS = { "adapters/wow/ClientCapabilities.lua", "adapters/wow/GuildBankAdapter.lua" }

describe("GuildBankAdapter", function()
  local env, ns, bank

  before_each(function()
    env = FakeWow.new({
      money = 987654,
      tabs = {
        { name = "Potions", items = { [1] = { itemId = 22832, count = 5 }, [98] = { itemId = 13444, count = 3 } } },
        { name = "Officers", viewable = false, items = {} },
        { name = "Mats", items = { [4] = { itemId = 21886, count = 10 } } },
      },
    })
    ns = Loader.withAdapters(env, ADAPTERS)
    bank = ns.GuildBankAdapter.new(ns.ClientCapabilities.new())
  end)

  it("implements BankPort", function()
    assert.is_true((ns.Ports.check("BankPort", bank)))
  end)

  it("lists tabs with their viewability", function()
    assert.are.same({
      { index = 1, name = "Potions", viewable = true },
      { index = 2, name = "Officers", viewable = false },
      { index = 3, name = "Mats", viewable = true },
    }, bank:listTabs())
  end)

  it("takes capacity from MAX_GUILDBANK_SLOTS_PER_TAB, else 98", function()
    assert.are.equal(98, bank:getCapacity(1))
    env.MAX_GUILDBANK_SLOTS_PER_TAB = 112
    assert.are.equal(112, bank:getCapacity(1))
  end)

  it("reads item ID, count and link together from each occupied slot", function()
    local slots = bank:readTabSlots(1)
    assert.are.equal(2, #slots)
    assert.are.equal(1, slots[1].slot)
    assert.are.equal(22832, slots[1].itemId)
    assert.are.equal(5, slots[1].count)
    assert.matches("|Hitem:22832:", slots[1].link)
    assert.are.equal(98, slots[2].slot)
  end)

  it("fails the read while a link is not available yet", function()
    env.bank.tabs[1].items[1].link = false
    local slots, reason = bank:readTabSlots(1)
    assert.is_nil(slots)
    assert.are.equal("link_pending", reason)
  end)

  it("knows the source identity and region", function()
    assert.are.same({ guild = "Toads", realm = "Spineshatter", region = "EU", uploaderName = "Bankalt",
      uploaderRealm = "Spineshatter" }, bank:getSourceIdentity())
    env.GetCurrentRegionName = function() return "US" end
    assert.are.equal("US", bank:getSourceIdentity().region)
    env.GetCurrentRegionName, env.GetCurrentRegion = nil, nil
    assert.are.equal("", bank:getSourceIdentity().region)
  end)

  it("tags GUILDBANKBAGSLOTS_CHANGED with the tab it last queried and reports open and close", function()
    local events = {}
    bank:subscribeToUpdates(function(e) events[#events + 1] = e.type .. ":" .. tostring(e.tab) end)
    assert.is_false(bank:isOpen())
    assert.is_false((bank:queryTab(1)))
    FakeWow.fire(env, "GUILDBANKFRAME_OPENED")
    assert.is_true(bank:isOpen())
    assert.is_true((bank:queryTab(3)))
    assert.are.same({ 3 }, env.queried)
    FakeWow.fire(env, "GUILDBANKBAGSLOTS_CHANGED")
    FakeWow.fire(env, "GUILDBANKFRAME_CLOSED")
    assert.is_false(bank:isOpen())
    assert.are.same({ "opened:nil", "changed:3", "closed:nil" }, events)
  end)

  it("follows the interaction manager for the guild banker where the client has it", function()
    env.Enum = { PlayerInteractionType = { GuildBanker = 10, Merchant = 5 } }
    bank = ns.GuildBankAdapter.new(ns.ClientCapabilities.new())
    FakeWow.fire(env, "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 5)
    assert.is_false(bank:isOpen())
    FakeWow.fire(env, "PLAYER_INTERACTION_MANAGER_FRAME_SHOW", 10)
    assert.is_true(bank:isOpen())
    FakeWow.fire(env, "PLAYER_INTERACTION_MANAGER_FRAME_HIDE", 10)
    assert.is_false(bank:isOpen())
  end)

  it("loads on a client that does not know an event", function()
    env.unknownEvents = { GUILDBANKFRAME_OPENED = true }
    assert.is_not_nil(ns.GuildBankAdapter.new(ns.ClientCapabilities.new()))
  end)

  describe("driving a scan", function()
    local clock, store, scanner

    before_each(function()
      clock = ManualClock.new(1790799000)
      store = MemoryStore.new()
      local capabilities = ns.ClientCapabilities.new()
      scanner = ns.ScanCoordinator.new({ bank = bank, clock = clock, capabilities = capabilities, store = store,
        addonVersion = "1.0.0", random = function() return 1 end })
      FakeWow.fire(env, "GUILDBANKFRAME_OPENED")
    end)

    it("TB-BM-01 TB-BM-02 queries viewable tabs one at a time and reads each after its signal", function()
      assert.is_true((scanner:start()))
      assert.are.same({ 1 }, env.queried)
      clock:advance(1)
      assert.are.same({ 1 }, env.queried, "waits for the signal")
      FakeWow.fire(env, "GUILDBANKBAGSLOTS_CHANGED")
      clock:advance(1)
      assert.are.same({ 1, 3 }, env.queried)
      FakeWow.fire(env, "GUILDBANKBAGSLOTS_CHANGED")
      clock:advance(1)
      local snap = store.last
      assert.are.equal("observed", snap.tabs[1].status)
      assert.are.equal(2, #snap.tabs[1].slots)
      assert.are.equal("unknown", snap.tabs[2].status)
      assert.are.equal("observed", snap.tabs[3].status)
      assert.are.equal(987654, snap.money)
      assert.are.same({ flavour = "tbc", build = "2.5.5.65000", interface = 20505 }, snap.client)
      assert.are.equal("spineshatter-bankalt-1790799000-0001", snap.snapshotId)
      assert.is_true((ns.Validator.validate(snap, clock:now())))
    end)

    it("TB-BM-04 aborts when the guild bank window closes", function()
      scanner:start()
      FakeWow.fire(env, "GUILDBANKFRAME_CLOSED")
      assert.are.equal("aborted", scanner:status().state)
      assert.are.equal("bank_closed", scanner:status().reason)
      assert.is_nil(store.last)
    end)
  end)
end)
