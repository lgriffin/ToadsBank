-- Timer (ClockPort in WoW): C_Timer when present, else an OnUpdate frame.
local Loader = require("spec.helpers.loader")
local FakeWow = require("spec.helpers.fake_wow")

describe("Timer", function()
  it("uses C_Timer.NewTimer and cancels through the handle", function()
    local env = FakeWow.new()
    local timers = {}
    env.C_Timer = { NewTimer = function(delay, fn)
      local handle = { delay = delay, fn = fn }
      function handle:Cancel() self.cancelled = true end
      timers[#timers + 1] = handle
      return handle
    end }
    env.GetServerTime = function() return 1790799123 end
    local ns = Loader.withAdapters(env, { "adapters/wow/Timer.lua" })
    local clock = ns.Timer.new()
    assert.is_true((ns.Ports.check("ClockPort", clock)))
    assert.are.equal(1790799123, clock:now())
    local cancel = clock:schedule(5, function() end)
    assert.are.equal(5, timers[1].delay)
    cancel()
    assert.is_true(timers[1].cancelled)
  end)

  it("falls back to an OnUpdate frame", function()
    local env = FakeWow.new()
    local now = 100
    env.GetTime = function() return now end
    env.time = function() return 1790799000 end
    local ns = Loader.withAdapters(env, { "adapters/wow/Timer.lua" })
    local clock = ns.Timer.new()
    assert.are.equal(1790799000, clock:now())
    local fired = {}
    clock:schedule(1, function() fired[#fired + 1] = "a" end)
    local cancel = clock:schedule(2, function() fired[#fired + 1] = "b" end)
    clock:schedule(3, function() fired[#fired + 1] = "c" end)
    cancel()
    local frame = env.frames[1]
    now = 101.5
    frame.scripts.OnUpdate(frame)
    assert.are.same({ "a" }, fired)
    now = 104
    frame.scripts.OnUpdate(frame)
    assert.are.same({ "a", "c" }, fired)
    assert.is_false(frame:IsShown())
  end)
end)
