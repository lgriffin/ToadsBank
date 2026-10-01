-- ClientCapabilities (CapabilityPort in WoW) and TB-DM-04: where the client lacks the guild bank API the source is
-- reported unsupported and nothing is scanned.
local Loader = require("spec.helpers.loader")
local FakeWow = require("spec.helpers.fake_wow")
local ManualClock = require("spec.fakes.ManualClock")
local MemoryStore = require("spec.fakes.MemoryStore")

local ADAPTERS = { "adapters/wow/ClientCapabilities.lua", "adapters/wow/GuildBankAdapter.lua" }

describe("ClientCapabilities", function()
  it("derives the TBC profile from GetBuildInfo", function()
    local env = FakeWow.new()
    local ns = Loader.withAdapters(env, ADAPTERS)
    assert.are.same({ flavour = "tbc", build = "2.5.5.65000", interface = 20505, supportsGuildBank = true },
      ns.ClientCapabilities.new():getProfile())
    assert.is_true((ns.Ports.check("CapabilityPort", ns.ClientCapabilities.new())))
  end)

  it("maps interface numbers to flavours; the Forever rule is a placeholder until the probe", function()
    local ns = Loader.withAdapters(FakeWow.new(), ADAPTERS)
    local C = ns.ClientCapabilities
    assert.are.equal("tbc", C.flavourFor("2.5.5", "1", 20505))
    assert.are.equal("classic_era", C.flavourFor("1.15.7", "1", 11507))
    assert.are.equal("wrath", C.flavourFor("3.4.3", "1", 30403))
    assert.are.equal("retail", C.flavourFor("11.2.0", "1", 110200))
    assert.are.equal("unknown", C.flavourFor("", "", nil))
    assert.is_false(C.isForever("2.5.5", "1", 20505))
  end)

  it("TB-DM-04 reports the guild bank unsupported when any guild bank function is missing", function()
    local env = FakeWow.new()
    env.QueryGuildBankTab = nil
    local ns = Loader.withAdapters(env, ADAPTERS)
    assert.is_false(ns.ClientCapabilities.new():getProfile().supportsGuildBank)
  end)

  it("TB-DM-04 refuses to scan on such a client and touches no tab", function()
    local env = FakeWow.new({ tabs = { { name = "A", items = { [1] = { itemId = 1, count = 1 } } } } })
    env.GetGuildBankItemLink = nil
    local ns = Loader.withAdapters(env, ADAPTERS)
    local capabilities = ns.ClientCapabilities.new()
    local bank = ns.GuildBankAdapter.new(capabilities)
    FakeWow.fire(env, "GUILDBANKFRAME_OPENED")
    local store = MemoryStore.new()
    local scanner = ns.ScanCoordinator.new({ bank = bank, clock = ManualClock.new(), capabilities = capabilities,
      store = store })
    local ok, reason = scanner:start()
    assert.is_false(ok)
    assert.are.equal("unsupported", reason)
    assert.are.equal("unsupported", scanner:status().state)
    assert.are.equal(0, #env.queried)
    assert.is_nil(store.last)
  end)
end)
