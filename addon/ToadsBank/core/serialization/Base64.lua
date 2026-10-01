-- Standard base64 (RFC 4648, "+/" alphabet, "=" padding), on byte strings. Pure arithmetic: no bit library needed.
local _, ns = ...

local Base64 = {}

local floor, byte, char, concat = math.floor, string.byte, string.char, table.concat

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local ENCODE, DECODE = {}, {}
for i = 1, 64 do
  local c = ALPHABET:sub(i, i)
  ENCODE[i - 1] = c
  DECODE[byte(c)] = i - 1
end

function Base64.encode(s)
  local out = {}
  local len = #s
  for i = 1, len, 3 do
    local a, b, c = byte(s, i, i + 2)
    local n = a * 65536 + (b or 0) * 256 + (c or 0)
    local c1 = floor(n / 262144)
    local c2 = floor(n / 4096) % 64
    local c3 = floor(n / 64) % 64
    local c4 = n % 64
    if c then
      out[#out + 1] = ENCODE[c1] .. ENCODE[c2] .. ENCODE[c3] .. ENCODE[c4]
    elseif b then
      out[#out + 1] = ENCODE[c1] .. ENCODE[c2] .. ENCODE[c3] .. "="
    else
      out[#out + 1] = ENCODE[c1] .. ENCODE[c2] .. "=="
    end
  end
  return concat(out)
end

-- Returns the decoded bytes, or nil and a reason for text that is not padded standard base64.
function Base64.decode(text)
  local len = #text
  if len % 4 ~= 0 then
    return nil, "length is not a multiple of 4"
  end
  local out = {}
  for i = 1, len, 4 do
    local q1, q2, q3, q4 = byte(text, i, i + 3)
    local last = i + 3 == len
    local v1, v2 = DECODE[q1], DECODE[q2]
    local v3 = DECODE[q3]
    local v4 = DECODE[q4]
    if v1 == nil or v2 == nil then
      return nil, "invalid character"
    end
    local pad3, pad4 = q3 == 61, q4 == 61
    if (pad3 or pad4) and not last then
      return nil, "padding before the end"
    end
    if (v3 == nil and not pad3) or (v4 == nil and not pad4) or (pad3 and not pad4) then
      return nil, "invalid character"
    end
    local n = v1 * 262144 + v2 * 4096 + (v3 or 0) * 64 + (v4 or 0)
    local a, b, c = floor(n / 65536), floor(n / 256) % 256, n % 256
    if pad3 then
      out[#out + 1] = char(a)
    elseif pad4 then
      out[#out + 1] = char(a, b)
    else
      out[#out + 1] = char(a, b, c)
    end
  end
  return concat(out)
end

ns.Base64 = Base64
