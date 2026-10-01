-- CRC-32 (IEEE 802.3, as zlib) of a byte string. Lua 5.1 has no bit operators, so the bit operations are injected:
-- in WoW the global `bit` library (LuaBitOp), in the specs a pure-Lua shim. Either may return signed 32-bit results;
-- the checksum is normalised to 0..2^32-1 at the end.
local _, ns = ...

local Crc32 = {}

local floor, byte, format = math.floor, string.byte, string.format
local TWO32 = 4294967296
local POLY = 0xEDB88320
local ALL = 0xFFFFFFFF

local function normalise(v)
  return v % TWO32
end

-- bitOps: a table with band, bxor and rshift (32-bit). Returns a calculator with checksum(s) and hex(s).
function Crc32.new(bitOps)
  assert(type(bitOps) == "table", "Crc32.new needs a bit operations table")
  local band, bxor, rshift = bitOps.band, bitOps.bxor, bitOps.rshift
  assert(band and bxor and rshift, "Crc32.new needs band, bxor and rshift")

  local lookup = {}
  for i = 0, 255 do
    local c = i
    for _ = 1, 8 do
      if band(c, 1) == 1 then
        c = bxor(POLY, rshift(c, 1))
      else
        c = rshift(c, 1)
      end
    end
    lookup[i] = c
  end

  local calculator = {}

  function calculator.checksum(s)
    local crc = ALL
    for i = 1, #s do
      crc = bxor(rshift(crc, 8), lookup[band(bxor(crc, byte(s, i)), 0xFF)])
    end
    return normalise(bxor(crc, ALL))
  end

  function calculator.hex(s)
    return Crc32.toHex(calculator.checksum(s))
  end

  return calculator
end

-- Eight lowercase hex digits. Formats two 16-bit halves so it never depends on the C long being 64-bit.
function Crc32.toHex(value)
  value = normalise(value)
  return format("%04x%04x", floor(value / 65536), value % 65536)
end

ns.Crc32 = Crc32
