-- /toadsbank scan | export | status | abort and the status line (driving side).
local Loader = require("spec.helpers.loader")
local FakeWow = require("spec.helpers.fake_wow")

describe("SlashCommands and ScanPanel.describe", function()
  local ns, called, app

  before_each(function()
    ns = Loader.withAdapters(FakeWow.new(), { "adapters/ui/ScanPanel.lua", "adapters/ui/SlashCommands.lua" })
    called = {}
    app = {}
    for _, name in ipairs({ "scan", "export", "status", "abort", "print" }) do
      app[name] = function(arg)
        called[#called + 1] = name .. (arg and (":" .. arg) or "")
      end
    end
  end)

  it("routes each command", function()
    for _, input in ipairs({ "scan", " EXPORT ", "status now", "abort" }) do
      assert.is_true(ns.SlashCommands.dispatch(input, app))
    end
    assert.are.same({ "scan", "export", "status", "abort" }, called)
  end)

  it("prints usage for anything else", function()
    assert.is_false(ns.SlashCommands.dispatch("", app))
    assert.are.equal("print:" .. ns.SlashCommands.USAGE, called[1])
  end)

  it("registers /toadsbank and /tbank", function()
    local env = FakeWow.new()
    env.SlashCmdList = {}
    local loaded = Loader.withAdapters(env, { "adapters/ui/SlashCommands.lua" })
    loaded.SlashCommands.register(app)
    assert.are.equal("/toadsbank", env.SLASH_TOADSBANK1)
    assert.are.equal("/tbank", env.SLASH_TOADSBANK2)
    env.SlashCmdList.TOADSBANK("scan")
    assert.are.same({ "scan" }, called)
  end)

  it("describes each scan state in one line", function()
    local d = ns.ScanPanel.describe
    assert.matches("idle", d({ state = "idle" }))
    assert.are.equal("scanning tab 2 (1 of 6 done)", d({ state = "scanning", tab = 2, tabsDone = 1, tabsTotal = 6 }))
    assert.matches("unstable", d({ state = "complete", reason = "unstable", snapshotId = "x" }))
    assert.matches("previous snapshot kept", d({ state = "aborted", reason = "bank_closed" }))
    assert.matches("unsupported", d({ state = "unsupported", reason = "unsupported" }))
  end)
end)
