-- Pure-Lua 32-bit operations with LuaBitOp's names (band, bor, bxor, bnot, lshift, rshift), for Crc32 in the specs.
-- Inputs are reduced modulo 2^32; results are unsigned. WoW supplies the real `bit` library.
local floor = math.floor
local TWO32 = 4294967296

local function norm(x)
  return floor(x) % TWO32
end

-- 4-bit lookup tables keep this fast enough for the golden payload.
local AND, OR, XOR = {}, {}, {}
for a = 0, 15 do
  AND[a], OR[a], XOR[a] = {}, {}, {}
  for b = 0, 15 do
    local r_and, r_or, r_xor, bitValue = 0, 0, 0, 1
    local x, y = a, b
    for _ = 1, 4 do
      local xb, yb = x % 2, y % 2
      if xb == 1 and yb == 1 then
        r_and = r_and + bitValue
      end
      if xb == 1 or yb == 1 then
        r_or = r_or + bitValue
      end
      if xb ~= yb then
        r_xor = r_xor + bitValue
      end
      x, y, bitValue = floor(x / 2), floor(y / 2), bitValue * 2
    end
    AND[a][b], OR[a][b], XOR[a][b] = r_and, r_or, r_xor
  end
end

local function combine(lookup, a, b)
  a, b = norm(a), norm(b)
  local result, scale = 0, 1
  for _ = 1, 8 do
    result = result + lookup[a % 16][b % 16] * scale
    a, b, scale = floor(a / 16), floor(b / 16), scale * 16
  end
  return result
end

local purebit = {}

function purebit.band(a, b)
  return combine(AND, a, b)
end

function purebit.bor(a, b)
  return combine(OR, a, b)
end

function purebit.bxor(a, b)
  return combine(XOR, a, b)
end

function purebit.bnot(a)
  return TWO32 - 1 - norm(a)
end

function purebit.lshift(a, n)
  return norm(norm(a) * 2 ^ n)
end

function purebit.rshift(a, n)
  return floor(norm(a) / 2 ^ n)
end

return purebit
