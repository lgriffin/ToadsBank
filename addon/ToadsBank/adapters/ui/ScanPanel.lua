-- Driving side: a small movable panel with one status line and Scan / Export buttons. Shown while the guild bank
-- is open and on /toadsbank status.
local _, ns = ...

local ScanPanel = {}
ScanPanel.__index = ScanPanel

local REASONS = {
  unsupported = "this client has no guild bank API: source unsupported, nothing scanned",
  bank_closed = "the guild bank closed: scan aborted, previous snapshot kept",
  user = "aborted: previous snapshot kept",
  invalid_snapshot = "the scan produced an invalid snapshot and was not saved",
}

-- One line for a ScanUseCase status. Pure, so SlashCommands and the specs share it.
function ScanPanel.describe(status)
  local state = status.state
  if state == "scanning" then
    if status.tab then
      return string.format("scanning tab %d (%d of %d done)", status.tab, status.tabsDone or 0, status.tabsTotal or 0)
    end
    return "scanning"
  elseif state == "complete" then
    local text = "scan complete: " .. tostring(status.snapshotId)
    if status.reason == "unstable" then
      text = text .. " (bank changed during the scan: some tabs unstable)"
    end
    return text
  elseif state == "aborted" or state == "unsupported" or state == "failed" then
    return REASONS[status.reason] or (state .. ": " .. tostring(status.reason))
  end
  return "idle: open the guild bank and press Scan"
end

-- actions: {scan = fn, export = fn}
function ScanPanel.new(scanner, actions)
  local self = setmetatable({ scanner = scanner }, ScanPanel)
  local template = BackdropTemplateMixin and "BackdropTemplate" or nil
  local frame = CreateFrame("Frame", "ToadsBankScanPanel", UIParent, template)
  frame:SetSize(320, 74)
  frame:SetPoint("TOP", UIParent, "TOP", 0, -140)
  frame:SetFrameStrata("DIALOG")
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
  if frame.SetBackdrop then
    frame:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 32, edgeSize = 16,
      insets = { left = 4, right = 4, top = 4, bottom = 4 },
    })
  end

  local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  title:SetPoint("TOPLEFT", 12, -10)
  title:SetText("ToadsBank")

  local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", 0, 0)

  self.text = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  self.text:SetPoint("TOPLEFT", 12, -28)
  self.text:SetPoint("RIGHT", -12, 0)
  self.text:SetJustifyH("LEFT")

  local scan = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
  scan:SetSize(80, 20)
  scan:SetPoint("BOTTOMLEFT", 12, 10)
  scan:SetText("Scan")
  scan:SetScript("OnClick", actions.scan)

  local export = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
  export:SetSize(80, 20)
  export:SetPoint("LEFT", scan, "RIGHT", 8, 0)
  export:SetText("Export")
  export:SetScript("OnClick", actions.export)

  self.frame = frame
  frame:Hide()
  scanner:subscribe(function(status)
    self:update(status)
  end)
  self:update(scanner:status())
  return self
end

function ScanPanel:update(status)
  self.text:SetText(ScanPanel.describe(status))
end

function ScanPanel:show()
  self:update(self.scanner:status())
  self.frame:Show()
end

function ScanPanel:hide()
  self.frame:Hide()
end

ns.ScanPanel = ScanPanel
