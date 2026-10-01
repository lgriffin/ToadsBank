-- ToadsBank Slice 0 capability probe. Records what this client offers for guild bank scanning into
-- ToadsBankProbeDB: build, interface version, which guild bank functions and events exist, tab and slot counts, and
-- every guild bank event seen while it pages the tabs one at a time. See ../README.md.
local addonName = ...

local PROBE_VERSION = 1
local WAIT_PER_TAB = 3 -- seconds of events recorded after each tab's query

local FUNCTIONS = {
  "GetNumGuildBankTabs", "GetGuildBankTabInfo", "QueryGuildBankTab", "GetGuildBankItemInfo", "GetGuildBankItemLink",
  "GetGuildBankMoney", "GetCurrentGuildBankTab", "SetCurrentGuildBankTab", "GetGuildBankTabPermissions",
  "GetGuildBankWithdrawMoney", "GetGuildInfo", "GetRealmName", "GetNormalizedRealmName", "GetCurrentRegion",
  "GetCurrentRegionName", "GetServerTime", "GetBuildInfo", "GetAddOnMetadata",
}

local EVENTS = {
  "GUILDBANKFRAME_OPENED", "GUILDBANKFRAME_CLOSED", "GUILDBANKBAGSLOTS_CHANGED", "GUILDBANK_UPDATE_TABS",
  "GUILDBANK_UPDATE_MONEY", "GUILDBANK_UPDATE_WITHDRAWMONEY", "GUILDBANK_ITEM_LOCK_CHANGED", "GUILDBANKLOG_UPDATE",
  "GUILDBANK_UPDATE_TEXT", "GUILDBANK_TEXT_CHANGED", "PLAYER_INTERACTION_MANAGER_FRAME_SHOW",
  "PLAYER_INTERACTION_MANAGER_FRAME_HIDE",
}

local frame = CreateFrame("Frame")
local registered = {}
local run -- the run in progress, if any

local function say(message)
  DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99ToadsBankProbe|r: " .. tostring(message))
end

local function pack(...)
  return { n = select("#", ...), ... }
end

-- SavedVariables cannot hold nil holes reliably, so returns are stored as strings in a sequence.
local function describe(values)
  local out = {}
  for i = 1, values.n do
    out[i] = tostring(values[i])
  end
  return out
end

local function after(delay, fn)
  if type(C_Timer) == "table" and type(C_Timer.After) == "function" then
    C_Timer.After(delay, fn)
    return
  end
  local timer = CreateFrame("Frame")
  local start = GetTime()
  timer:SetScript("OnUpdate", function(self)
    if GetTime() - start >= delay then
      self:SetScript("OnUpdate", nil)
      fn()
    end
  end)
end

local function client()
  local version, build, date, tocversion = GetBuildInfo()
  local functions = {}
  for _, name in ipairs(FUNCTIONS) do
    functions[name] = type(_G[name])
  end
  local interaction = type(Enum) == "table" and Enum.PlayerInteractionType
  return {
    version = version,
    build = build,
    date = date,
    interface = tocversion,
    projectId = WOW_PROJECT_ID,
    maxSlotsPerTab = MAX_GUILDBANK_SLOTS_PER_TAB,
    maxTabs = MAX_GUILDBANK_TABS,
    guildBankerInteraction = interaction and interaction.GuildBanker or nil,
    hasBitLibrary = type(bit) == "table",
    hasCTimer = type(C_Timer) == "table",
    hasBackdropTemplate = BackdropTemplateMixin ~= nil,
    functions = functions,
    eventsRegistered = registered,
    guildBankSupported = type(GetNumGuildBankTabs) == "function" and type(QueryGuildBankTab) == "function"
      and type(GetGuildBankItemLink) == "function",
  }
end

local function character()
  local guild, rankName, rankIndex = GetGuildInfo("player")
  return { name = UnitName("player"), realm = GetRealmName(), guild = guild, rank = rankName, rankIndex = rankIndex }
end

local function db()
  ToadsBankProbeDB = type(ToadsBankProbeDB) == "table" and ToadsBankProbeDB or {}
  ToadsBankProbeDB.probeVersion = PROBE_VERSION
  ToadsBankProbeDB.runs = ToadsBankProbeDB.runs or {}
  return ToadsBankProbeDB
end

-- What the client returns for one tab right now: occupied slots, how many have a link, a few samples.
local function readTab(tab, capacity)
  local occupied, withLink, samples = 0, 0, {}
  for slot = 1, capacity do
    local texture, count, locked = GetGuildBankItemInfo(tab, slot)
    if texture then
      occupied = occupied + 1
      local link = GetGuildBankItemLink(tab, slot)
      if link then
        withLink = withLink + 1
      end
      if #samples < 3 then
        samples[#samples + 1] = { slot = slot, count = count, locked = locked and true or false, link = link }
      end
    end
  end
  return { occupied = occupied, withLink = withLink, samples = samples }
end

local function finish()
  local capacity = MAX_GUILDBANK_SLOTS_PER_TAB or 98
  -- Re-read every tab at the end: does the client still hold data for tabs other than the last one queried?
  for _, tab in ipairs(run.tabs) do
    if tab.viewable then
      tab.rereadAtEnd = readTab(tab.index, capacity)
    end
  end
  run.finishedAt = time()
  run.durationSeconds = GetTime() - run.startClock
  local saved = db()
  saved.runs[#saved.runs + 1] = run
  say(string.format("run %d saved: %d tabs, %d events. /reload or log out to write the file.", #saved.runs,
    #run.tabs, #run.events))
  run = nil
end

local function pageTab(position)
  local tab = run and run.tabs[position]
  if not run then
    return
  end
  if not tab then
    finish()
    return
  end
  if not tab.viewable then
    pageTab(position + 1)
    return
  end
  run.queriedTab = tab.index
  tab.queriedAt = GetTime() - run.startClock
  if type(GetCurrentGuildBankTab) == "function" then
    tab.currentTabBefore = GetCurrentGuildBankTab()
  end
  QueryGuildBankTab(tab.index)
  after(WAIT_PER_TAB, function()
    if not run then
      return
    end
    tab.read = readTab(tab.index, MAX_GUILDBANK_SLOTS_PER_TAB or 98)
    if type(GetCurrentGuildBankTab) == "function" then
      tab.currentTabAfter = GetCurrentGuildBankTab()
    end
    pageTab(position + 1)
  end)
end

local function start()
  if run then
    say("a run is already in progress.")
    return
  end
  if type(GetNumGuildBankTabs) ~= "function" then
    local saved = db()
    saved.runs[#saved.runs + 1] = { at = time(), client = client(), character = character(), unsupported = true }
    say("this client has no guild bank API; recorded as unsupported.")
    return
  end
  run = {
    at = time(),
    startClock = GetTime(),
    client = client(),
    character = character(),
    bankOpen = GuildBankFrame ~= nil and GuildBankFrame:IsShown() or false,
    money = type(GetGuildBankMoney) == "function" and GetGuildBankMoney() or nil,
    tabCount = GetNumGuildBankTabs(),
    tabs = {},
    events = {},
  }
  for index = 1, run.tabCount do
    local info = pack(GetGuildBankTabInfo(index))
    run.tabs[index] = { index = index, info = describe(info), name = info[1], viewable = info[3] and true or false }
  end
  say(string.format("paging %d tabs, %d seconds each; keep the guild bank open.", run.tabCount, WAIT_PER_TAB))
  pageTab(1)
end

frame:SetScript("OnEvent", function(_, event, ...)
  if event == "ADDON_LOADED" then
    if ... == addonName then
      db().client = client()
    end
    return
  end
  if run then
    run.events[#run.events + 1] = {
      t = GetTime() - run.startClock,
      event = event,
      args = describe(pack(...)),
      queriedTab = run.queriedTab,
    }
  end
  if event == "GUILDBANKFRAME_OPENED" then
    say("guild bank open: /tbprobe to record a run.")
  end
end)

frame:RegisterEvent("ADDON_LOADED")
for _, event in ipairs(EVENTS) do
  registered[event] = pcall(frame.RegisterEvent, frame, event) and true or false
end

SLASH_TBPROBE1 = "/tbprobe"
SlashCmdList.TBPROBE = function(input)
  local command = tostring(input or ""):lower():match("^%s*(%S*)")
  if command == "clear" then
    ToadsBankProbeDB = nil
    db()
    say("cleared.")
  elseif command == "status" then
    local saved = db()
    say(string.format("%d run(s) recorded%s.", #saved.runs, run and ", one in progress" or ""))
  else
    start()
  end
end
