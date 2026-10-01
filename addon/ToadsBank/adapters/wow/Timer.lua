-- ClockPort in WoW: server epoch seconds and one-shot timers. C_Timer.NewTimer where the client has it, else an
-- OnUpdate frame.
local _, ns = ...

local Timer = {}
Timer.__index = Timer

function Timer.new()
  local self = setmetatable({ pending = {} }, Timer)
  if not (type(C_Timer) == "table" and type(C_Timer.NewTimer) == "function") then
    self.frame = CreateFrame("Frame")
    self.frame:Hide()
    self.frame:SetScript("OnUpdate", function()
      self:tick()
    end)
  end
  return self
end

function Timer:now()
  if type(GetServerTime) == "function" then
    return GetServerTime()
  end
  return time()
end

function Timer:schedule(delay, fn)
  if not self.frame then
    local handle = C_Timer.NewTimer(delay, fn)
    return function()
      handle:Cancel()
    end
  end
  local timer = { at = GetTime() + delay, fn = fn }
  self.pending[#self.pending + 1] = timer
  self.frame:Show()
  return function()
    timer.cancelled = true
  end
end

function Timer:tick()
  local now = GetTime()
  local due, keep = {}, {}
  for _, timer in ipairs(self.pending) do
    if not timer.cancelled then
      if timer.at <= now then
        due[#due + 1] = timer
      else
        keep[#keep + 1] = timer
      end
    end
  end
  self.pending = keep
  if #keep == 0 then
    self.frame:Hide()
  end
  for _, timer in ipairs(due) do
    timer.fn()
  end
end

ns.Timer = Timer
