-- A fake WoW API environment for adapter specs. Loader.loadFile(path, ns, env) runs an adapter with this as its
-- globals, so the adapters keep calling WoW functions by their real names. Lookups fall through to Lua's own _G.
local FakeWow = {}

local function noop() end

-- Frames answer any method they do not model with a no-op, so UI code runs; text and scripts are recorded.
local FRAME_META = {
  __index = function()
    return noop
  end,
}

local function newFrame(env, kind, name)
  local frame = setmetatable({ kind = kind, name = name, events = {}, scripts = {}, shown = true }, FRAME_META)
  function frame:SetText(text)
    self.text = text
  end
  function frame:GetText()
    return self.text
  end
  function frame:CreateFontString()
    return newFrame(env, "FontString")
  end
  function frame:GetScript(script)
    return self.scripts[script]
  end
  function frame:RegisterEvent(event)
    if env.unknownEvents and env.unknownEvents[event] then
      error("Attempt to register unknown event \"" .. event .. "\"")
    end
    self.events[event] = true
  end
  function frame:UnregisterEvent(event)
    self.events[event] = nil
  end
  function frame:SetScript(script, fn)
    self.scripts[script] = fn
  end
  function frame:Show()
    self.shown = true
  end
  function frame:Hide()
    self.shown = false
  end
  function frame:IsShown()
    return self.shown
  end
  -- Delivers an event the way the client would, if the frame registered for it.
  function frame:fire(event, ...)
    if self.events[event] and self.scripts.OnEvent then
      self.scripts.OnEvent(self, event, ...)
    end
  end
  env.frames[#env.frames + 1] = frame
  return frame
end

-- bank: { tabs = { {name, viewable, items = { [slot] = {itemId, count, link?} } } }, money, lazy }
-- With lazy = true the fake models the client's cache: a tab's items are visible only once the server's answer
-- has arrived (FakeWow.deliver), and FakeWow.forget drops them again.
function FakeWow.new(bank)
  local env = { frames = {}, queried = {}, loaded = {}, bank = bank or { tabs = {} } }
  local function items(tab)
    if env.bank.lazy and not env.loaded[tab] then
      return {}
    end
    return env.bank.tabs[tab].items
  end
  env._G = env
  env.CreateFrame = function(kind, name)
    local frame = newFrame(env, kind, name)
    if name then
      env[name] = frame
    end
    return frame
  end
  env.GetBuildInfo = function()
    return "2.5.5", "65000", "Sep 1 2026", 20505
  end
  env.GetNumGuildBankTabs = function()
    return #env.bank.tabs
  end
  env.GetGuildBankTabInfo = function(tab)
    local t = env.bank.tabs[tab]
    return t.name, "Interface\\Icons\\INV_Misc_QuestionMark", t.viewable ~= false, true, -1, -1
  end
  env.QueryGuildBankTab = function(tab)
    env.queried[#env.queried + 1] = tab
  end
  env.GetGuildBankItemInfo = function(tab, slot)
    local item = items(tab)[slot]
    if item then
      return "Interface\\Icons\\INV_Potion_" .. item.itemId, item.count, false
    end
    return nil, 0, false
  end
  env.GetGuildBankItemLink = function(tab, slot)
    local item = items(tab)[slot]
    if not item then
      return nil
    end
    if item.link == false then
      return nil
    end
    return item.link or ("|cffffffff|Hitem:" .. item.itemId .. "::::::::70:::::|h[Item " .. item.itemId .. "]|h|r")
  end
  env.GetGuildBankMoney = function()
    return env.bank.money or 0
  end
  env.GetGuildInfo = function()
    return env.bank.guild or "Toads", "Officer", 1
  end
  env.GetRealmName = function()
    return "Spineshatter"
  end
  env.UnitName = function()
    return "Bankalt"
  end
  env.GetCurrentRegion = function()
    return 3
  end
  return setmetatable(env, { __index = _G })
end

-- The server's answer for a tab arrives: its items become visible and GUILDBANKBAGSLOTS_CHANGED fires.
function FakeWow.deliver(env, tab)
  env.loaded[tab] = true
  FakeWow.fire(env, "GUILDBANKBAGSLOTS_CHANGED")
end

-- The client drops its copy of a tab.
function FakeWow.forget(env, tab)
  env.loaded[tab] = nil
end

-- Runs every frame's OnUpdate, as one rendered frame would.
function FakeWow.tick(env)
  for _, frame in ipairs(env.frames) do
    if frame.scripts.OnUpdate then
      frame.scripts.OnUpdate(frame, 0.1)
    end
  end
end

-- The frame that registered for event.
function FakeWow.frameFor(env, event)
  for _, frame in ipairs(env.frames) do
    if frame.events[event] then
      return frame
    end
  end
end

function FakeWow.fire(env, event, ...)
  for _, frame in ipairs(env.frames) do
    frame:fire(event, ...)
  end
end

return FakeWow
