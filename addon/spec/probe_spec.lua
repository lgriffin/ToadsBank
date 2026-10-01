-- The Slice 0 probe runs in a fake client and records build, interface, guild bank capability, tab and slot counts
-- and the events seen while paging tabs.
local FakeWow = require("spec.helpers.fake_wow")

describe("ToadsBankProbe", function()
  it("records a run into ToadsBankProbeDB", function()
    local env = FakeWow.new({ tabs = {
      { name = "Potions", items = { [1] = { itemId = 22832, count = 5 } } },
      { name = "Officers", viewable = false, items = {} },
    } })
    local callbacks = {}
    env.C_Timer = { After = function(_, fn) callbacks[#callbacks + 1] = fn end }
    env.GetTime = function() return 50 end
    env.time = os.time
    env.SlashCmdList = {}
    env.DEFAULT_CHAT_FRAME = { AddMessage = function() end }
    local chunk = assert(loadfile("probe/ToadsBankProbe/ToadsBankProbe.lua"))
    setfenv(chunk, env)
    chunk("ToadsBankProbe", {})
    FakeWow.fire(env, "ADDON_LOADED", "ToadsBankProbe")
    assert.are.equal(20505, env.ToadsBankProbeDB.client.interface)
    FakeWow.fire(env, "GUILDBANKFRAME_OPENED")
    env.SlashCmdList.TBPROBE("")
    assert.are.same({ 1 }, env.queried)
    FakeWow.fire(env, "GUILDBANKBAGSLOTS_CHANGED")
    table.remove(callbacks, 1)()
    local run = env.ToadsBankProbeDB.runs[1]
    assert.is_not_nil(run)
    assert.are.equal(2, run.tabCount)
    assert.is_true(run.client.guildBankSupported)
    assert.are.equal("function", run.client.functions.QueryGuildBankTab)
    assert.are.equal(1, run.tabs[1].read.occupied)
    assert.are.equal(1, run.tabs[1].read.withLink)
    assert.is_false(run.tabs[2].viewable)
    assert.are.equal("GUILDBANKBAGSLOTS_CHANGED", run.events[1].event)
    assert.are.equal(1, run.events[1].queriedTab)
    env.SlashCmdList.TBPROBE("clear")
    assert.are.equal(0, #env.ToadsBankProbeDB.runs)
  end)
end)
