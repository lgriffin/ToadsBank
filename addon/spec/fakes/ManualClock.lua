-- ClockPort fake: time moves only when a spec calls advance(), which runs due timers in time order (including
-- timers those timers schedule).
local ManualClock = {}
ManualClock.__index = ManualClock

function ManualClock.new(start)
  return setmetatable({ time = start or 1790799000, timers = {}, sequence = 0 }, ManualClock)
end

function ManualClock:now()
  return self.time
end

function ManualClock:schedule(delay, fn)
  self.sequence = self.sequence + 1
  local timer = { at = self.time + delay, fn = fn, seq = self.sequence }
  self.timers[#self.timers + 1] = timer
  return function()
    timer.cancelled = true
  end
end

function ManualClock:pending()
  local n = 0
  for _, t in ipairs(self.timers) do
    if not t.cancelled then
      n = n + 1
    end
  end
  return n
end

local function nextDue(timers, limit)
  local best, bestIndex
  for i, t in ipairs(timers) do
    local earlier = best == nil or t.at < best.at or (t.at == best.at and t.seq < best.seq)
    if not t.cancelled and t.at <= limit and earlier then
      best, bestIndex = t, i
    end
  end
  return best, bestIndex
end

function ManualClock:advance(seconds)
  local limit = self.time + seconds
  while true do
    local timer, index = nextDue(self.timers, limit)
    if not timer then
      break
    end
    table.remove(self.timers, index)
    if timer.at > self.time then
      self.time = timer.at
    end
    timer.fn()
  end
  self.time = limit
end

return ManualClock
