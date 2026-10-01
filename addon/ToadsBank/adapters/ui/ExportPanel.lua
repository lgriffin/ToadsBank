-- Driving side: shows an export one part at a time (TB-BM-05). Each part is at most 1,800 characters, so the player
-- clicks into the box (it highlights everything), presses Ctrl+C and pastes it into the Discord modal; a Discord
-- text input takes 4,000 characters, so two parts fit one field. Prev / Next walk the parts.
local _, ns = ...

local ExportPanel = {}
ExportPanel.__index = ExportPanel

function ExportPanel.new()
  local self = setmetatable({ parts = {}, index = 1 }, ExportPanel)
  local template = BackdropTemplateMixin and "BackdropTemplate" or nil
  local frame = CreateFrame("Frame", "ToadsBankExportPanel", UIParent, template)
  frame:SetSize(560, 340)
  frame:SetPoint("CENTER")
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
  table.insert(UISpecialFrames, "ToadsBankExportPanel") -- Escape closes it

  local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  title:SetPoint("TOPLEFT", 14, -12)
  title:SetText("ToadsBank export: copy each part into Discord")

  local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
  close:SetPoint("TOPRIGHT", 0, 0)

  self.label = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  self.label:SetPoint("BOTTOM", 0, 16)

  local scroll = CreateFrame("ScrollFrame", "ToadsBankExportScroll", frame, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 14, -34)
  scroll:SetPoint("BOTTOMRIGHT", -34, 44)

  local edit = CreateFrame("EditBox", nil, scroll)
  edit:SetMultiLine(true)
  edit:SetAutoFocus(false)
  edit:SetFontObject(ChatFontNormal)
  edit:SetWidth(500)
  edit:SetMaxLetters(0)
  edit:SetScript("OnEscapePressed", function()
    frame:Hide()
  end)
  edit:SetScript("OnEditFocusGained", function(box)
    box:HighlightText()
  end)
  edit:SetScript("OnMouseUp", function(box)
    box:HighlightText()
  end)
  -- Read-only: typing puts the part back.
  edit:SetScript("OnTextChanged", function(box, userInput)
    if userInput then
      box:SetText(self.parts[self.index] or "")
      box:HighlightText()
    end
  end)
  scroll:SetScrollChild(edit)
  self.edit = edit

  local prev = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
  prev:SetSize(80, 22)
  prev:SetPoint("BOTTOMLEFT", 14, 12)
  prev:SetText("< Prev")
  prev:SetScript("OnClick", function()
    self:select(self.index - 1)
  end)
  self.prev = prev

  local nextButton = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
  nextButton:SetSize(80, 22)
  nextButton:SetPoint("BOTTOMRIGHT", -14, 12)
  nextButton:SetText("Next >")
  nextButton:SetScript("OnClick", function()
    self:select(self.index + 1)
  end)
  self.next = nextButton

  self.frame = frame
  frame:Hide()
  return self
end

-- export: the ExportUseCase result {snapshotId, parts}.
function ExportPanel:show(export)
  self.parts = export.parts
  self.snapshotId = export.snapshotId
  self.frame:Show()
  self:select(1)
end

function ExportPanel:select(index)
  local total = #self.parts
  if total == 0 then
    return
  end
  if index < 1 then
    index = 1
  elseif index > total then
    index = total
  end
  self.index = index
  self.edit:SetText(self.parts[index])
  self.edit:SetCursorPosition(0)
  self.edit:SetFocus()
  self.edit:HighlightText()
  self.label:SetText(string.format("Part %d of %d  (%s)", index, total, tostring(self.snapshotId)))
  if index > 1 then
    self.prev:Enable()
  else
    self.prev:Disable()
  end
  if index < total then
    self.next:Enable()
  else
    self.next:Disable()
  end
end

ns.ExportPanel = ExportPanel
