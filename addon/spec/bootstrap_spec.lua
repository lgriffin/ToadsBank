-- Bootstrap wires the whole addon in a fake WoW client: every .toc file loads, /toadsbank scan reads the bank after
-- its update signals and /toadsbank export shows parts of at most 1,800 characters (TB-BM-01, TB-BM-05).
local Loader = require("spec.helpers.loader")
local FakeWow = require("spec.helpers.fake_wow")
local purebit = require("spec.helpers.purebit")

describe("Bootstrap in a fake client", function()
  local env, messages, now

  local function advance(seconds)
    local target = now + seconds
    while now < target do
      now = now + 0.1
      FakeWow.tick(env)
    end
  end

  before_each(function()
    local items = {}
    for slot = 1, 98 do
      items[slot] = { itemId = 22000 + slot, count = slot % 20 + 1 }
    end
    local tabs = { { name = "Full", items = items }, { name = "Mats", items = {} } }
    env = FakeWow.new({ lazy = true, money = 5, tabs = tabs })
    messages = {}
    now = 1000
    env.GetTime = function() return now end
    env.GetServerTime = function() return 1790799000 + math.floor(now - 1000) end
    env.time = os.time
    env.bit = purebit
    env.UIParent = env.CreateFrame("Frame", "UIParent")
    env.UISpecialFrames = {}
    env.SlashCmdList = {}
    env.ChatFontNormal = {}
    env.BackdropTemplateMixin = {}
    env.GetAddOnMetadata = function(_, field) return field == "Version" and "@version@" or nil end
    env.DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) messages[#messages + 1] = text end }
    local ns = {}
    for _, file in ipairs(Loader.tocFiles()) do
      Loader.loadFile(file, ns, env)
    end
    FakeWow.fire(env, "ADDON_LOADED", "ToadsBank")
  end)

  local function lastMessage()
    return messages[#messages] or ""
  end

  it("creates ToadsBankDB and registers the slash commands", function()
    assert.are.equal("table", type(env.ToadsBankDB))
    assert.are.equal("/toadsbank", env.SLASH_TOADSBANK1)
    assert.are.equal("function", type(env.SlashCmdList.TOADSBANK))
  end)

  it("asks for the bank to be opened, then scans and exports", function()
    env.SlashCmdList.TOADSBANK("scan")
    assert.matches("open the guild bank first", lastMessage())
    env.SlashCmdList.TOADSBANK("export")
    assert.matches("nothing to export yet", lastMessage())

    FakeWow.fire(env, "GUILDBANKFRAME_OPENED")
    assert.is_true(env.ToadsBankScanPanel:IsShown())
    env.SlashCmdList.TOADSBANK("scan")
    assert.are.same({ 1 }, env.queried)
    advance(1)
    FakeWow.deliver(env, 1)
    advance(1)
    assert.are.same({ 1, 2 }, env.queried)
    FakeWow.deliver(env, 2) -- an empty tab looks the same before and after: ambiguous, so it is queried again
    advance(0.5)
    assert.are.same({ 1, 2, 2 }, env.queried)
    FakeWow.deliver(env, 2)
    advance(1)
    assert.matches("scan complete", lastMessage())
    local snap = env.ToadsBankDB.lastSnapshot
    assert.are.equal(98, #snap.tabs[1].slots)
    assert.are.equal("dev", snap.addon.version)
    assert.are.equal(1, #env.ToadsBankDB.history)

    env.SlashCmdList.TOADSBANK("export")
    assert.matches("part%(s%)", lastMessage())
    local panel = env.ToadsBankExportPanel
    assert.is_true(panel:IsShown())
    local shown = nil
    for _, frame in ipairs(env.frames) do
      if frame.kind == "EditBox" then
        shown = frame:GetText()
      end
    end
    assert.matches("^TOADSBANK/1 export=spineshatter%-bankalt%-1790799000%-%x%x%x%x part=1/%d+ crc32=%x+\n", shown)
    assert.truthy(#shown <= 1800)

    env.SlashCmdList.TOADSBANK("status")
    env.SlashCmdList.TOADSBANK("abort")
    assert.matches("no scan is running", lastMessage())
  end)

  it("aborts when the bank closes and keeps the previous snapshot (TB-BM-04)", function()
    FakeWow.fire(env, "GUILDBANKFRAME_OPENED")
    env.SlashCmdList.TOADSBANK("scan")
    FakeWow.fire(env, "GUILDBANKFRAME_CLOSED")
    assert.matches("scan aborted, previous snapshot kept", lastMessage())
    assert.is_nil(env.ToadsBankDB.lastSnapshot)
  end)
end)
