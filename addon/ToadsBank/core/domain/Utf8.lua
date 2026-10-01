-- UTF-8 rules shared with the service. The service decodes payloads with a fatal UTF-8 decoder and measures strings
-- in UTF-16 code units (JavaScript's .length), so the addon must (a) never export malformed UTF-8 (overlong forms,
-- surrogates D800-DFFF, code points above U+10FFFF, truncated sequences) and (b) count a supplementary-plane
-- character (4 bytes in UTF-8) as 2 units.
local _, ns = ...

local Utf8 = {}

Utf8.REPLACEMENT = "\239\191\189" -- U+FFFD

local byte = string.byte

-- Byte length of the well-formed sequence starting at i, or nil when the bytes there are not well-formed.
function Utf8.sequenceLength(s, i)
  local b1 = byte(s, i)
  if b1 == nil then
    return nil
  end
  if b1 < 0x80 then
    return 1
  end
  local length, low, high
  if b1 >= 0xC2 and b1 <= 0xDF then
    length, low, high = 2, 0x80, 0xBF
  elseif b1 == 0xE0 then
    length, low, high = 3, 0xA0, 0xBF -- no overlongs
  elseif b1 == 0xED then
    length, low, high = 3, 0x80, 0x9F -- no surrogates
  elseif b1 >= 0xE1 and b1 <= 0xEF then
    length, low, high = 3, 0x80, 0xBF
  elseif b1 == 0xF0 then
    length, low, high = 4, 0x90, 0xBF -- no overlongs
  elseif b1 >= 0xF1 and b1 <= 0xF3 then
    length, low, high = 4, 0x80, 0xBF
  elseif b1 == 0xF4 then
    length, low, high = 4, 0x80, 0x8F -- nothing above U+10FFFF
  else
    return nil -- continuation byte, C0/C1 overlong lead, F5..FF
  end
  local b2 = byte(s, i + 1)
  if b2 == nil or b2 < low or b2 > high then
    return nil
  end
  for k = i + 2, i + length - 1 do
    local b = byte(s, k)
    if b == nil or b < 0x80 or b > 0xBF then
      return nil
    end
  end
  return length
end

-- true, or false and the byte position of the first malformed sequence.
function Utf8.isValid(s)
  local i, n = 1, #s
  while i <= n do
    local length = Utf8.sequenceLength(s, i)
    if not length then
      return false, i
    end
    i = i + length
  end
  return true
end

-- s with every malformed byte replaced by U+FFFD, as a non-fatal decoder would read it.
function Utf8.sanitize(s)
  if Utf8.isValid(s) then
    return s
  end
  local out, i, n = {}, 1, #s
  while i <= n do
    local length = Utf8.sequenceLength(s, i)
    if length then
      out[#out + 1] = s:sub(i, i + length - 1)
      i = i + length
    else
      out[#out + 1] = Utf8.REPLACEMENT
      i = i + 1
    end
  end
  return table.concat(out)
end

-- Length in UTF-16 code units. A malformed byte counts as one unit (it would decode to one U+FFFD).
function Utf8.units(s)
  local count, i, n = 0, 1, #s
  while i <= n do
    local length = Utf8.sequenceLength(s, i) or 1
    count = count + (length == 4 and 2 or 1)
    i = i + length
  end
  return count
end

-- s sanitized and cut to at most maxUnits UTF-16 code units, never inside a sequence or a surrogate pair.
function Utf8.truncate(s, maxUnits)
  s = Utf8.sanitize(s)
  local count, i, n = 0, 1, #s
  while i <= n do
    local length = Utf8.sequenceLength(s, i)
    local units = length == 4 and 2 or 1
    if count + units > maxUnits then
      return s:sub(1, i - 1)
    end
    count = count + units
    i = i + length
  end
  return s
end

ns.Utf8 = Utf8
