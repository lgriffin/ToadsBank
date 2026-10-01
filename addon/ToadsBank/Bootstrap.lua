-- Composition root: on ADDON_LOADED, wires the WoW adapters into the core use cases and the UI.
local addonName, ns = ...

local function metadata(field)
  local get = (type(C_AddOns) == "table" and C_AddOns.GetAddOnMetadata) or GetAddOnMetadata
  local value = get and get(addonName, field)
  if type(value) ~= "string" or value == "" or value:find("@", 1, true) then
    return nil
  end
  return value
end

local function say(message)
  DEFAULT_CHAT_FRAME:AddMessage("|cff33ff99ToadsBank|r: " .. tostring(message))
end

local START_FAILURES = {
  unsupported = "this client has no guild bank API, so the source is unsupported and nothing was scanned.",
  bank_closed = "open the guild bank first.",
  no_guild = "this character is not in a guild.",
  busy = "a scan is already running (/toadsbank abort to stop it).",
}

local EXPORT_FAILURES = {
  no_snapshot = "nothing to export yet: open the guild bank and /toadsbank scan.",
  invalid_snapshot = "the last snapshot does not pass the contract, so it was not exported",
}

local function compose()
  ToadsBankDB = type(ToadsBankDB) == "table" and ToadsBankDB or {}

  local capabilities = ns.Ports.assert("CapabilityPort", ns.ClientCapabilities.new())
  local bank = ns.GuildBankAdapter.new(capabilities)
  local clock = ns.Timer.new()
  local store = ns.SavedVariablesStore.new(ToadsBankDB)
  local scanner = ns.ScanCoordinator.new({
    bank = bank,
    clock = clock,
    capabilities = capabilities,
    store = store,
    addonVersion = metadata("Version") or "dev",
  })
  local exporter = ns.ExportSnapshot.new({ store = store, clock = clock, bit = bit })

  local app = { print = say }
  local exportPanel = ns.ExportPanel.new()
  local scanPanel = ns.ScanPanel.new(scanner, {
    scan = function()
      app.scan()
    end,
    export = function()
      app.export()
    end,
  })

  function app.scan()
    local ok, reason = scanner:start()
    if ok then
      scanPanel:show()
      say("scanning the guild bank; keep the window open.")
    else
      say(START_FAILURES[reason] or ("cannot scan: " .. tostring(reason)))
    end
  end

  function app.export()
    local result, reason, issues = exporter:exportLatest()
    if not result then
      local text = EXPORT_FAILURES[reason] or ("cannot export: " .. tostring(reason))
      if issues then
        text = text .. ": " .. ns.Validator.describe(issues)
      end
      say(text)
      return
    end
    exportPanel:show(result)
    say(string.format("export %s is %d part(s); paste each into the Toads Discord.", result.snapshotId, #result.parts))
  end

  function app.status()
    say(ns.ScanPanel.describe(scanner:status()))
    local last = store:loadLastSnapshot()
    if last then
      local observed = 0
      for _, tab in ipairs(last.tabs) do
        if tab.status == "observed" then
          observed = observed + 1
        end
      end
      say(string.format("last snapshot %s: %d of %d tabs observed%s", last.snapshotId, observed, #last.tabs,
        last.stable and "" or ", unstable"))
    end
    local profile = capabilities:getProfile()
    say(string.format("client %s %s (interface %d), guild bank %s", profile.flavour, profile.build,
      profile.interface, profile.supportsGuildBank and "supported" or "unsupported"))
  end

  function app.abort()
    local ok = scanner:abort("user")
    say(ok and "scan aborted; the previous snapshot is kept." or "no scan is running.")
  end

  scanner:subscribe(function(status)
    if status.state == "complete" or status.state == "aborted" or status.state == "failed" then
      say(ns.ScanPanel.describe(status))
    end
  end)

  bank:subscribeToUpdates(function(event)
    if event.type == "opened" then
      scanPanel:show()
    elseif event.type == "closed" then
      scanPanel:hide()
    end
  end)

  ns.SlashCommands.register(app)
  ns.app = app
end

local loader = CreateFrame("Frame")
loader:RegisterEvent("ADDON_LOADED")
loader:SetScript("OnEvent", function(self, _, name)
  if name == addonName then
    self:UnregisterEvent("ADDON_LOADED")
    compose()
  end
end)
