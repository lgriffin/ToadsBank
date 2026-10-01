-- Crc32 with injected bit operations (TB-DM-02): the specs use a pure-Lua shim, WoW the global `bit` library.
local Loader = require("spec.helpers.loader")
local purebit = require("spec.helpers.purebit")

describe("Crc32 (TB-DM-02)", function()
  local Crc32

  before_each(function()
    Crc32 = Loader.core().Crc32
  end)

  it("gives the IEEE check value for 123456789", function()
    assert.are.equal("cbf43926", Crc32.new(purebit).hex("123456789"))
    assert.are.equal(3421780262, Crc32.new(purebit).checksum("123456789"))
  end)

  it("gives 00000000 for empty input and known values for others", function()
    local crc = Crc32.new(purebit)
    assert.are.equal("00000000", crc.hex(""))
    assert.are.equal("e8b7be43", crc.hex("a"))
    assert.are.equal("414fa339", crc.hex("The quick brown fox jumps over the lazy dog"))
  end)

  it("accepts a LuaBitOp-style library that returns signed results", function()
    local function signed(v)
      v = v % 4294967296
      if v >= 2147483648 then
        return v - 4294967296
      end
      return v
    end
    local signedBit = {
      band = function(a, b) return signed(purebit.band(a, b)) end,
      bxor = function(a, b) return signed(purebit.bxor(a, b)) end,
      rshift = function(a, n) return signed(purebit.rshift(a, n)) end,
    }
    assert.are.equal("cbf43926", Crc32.new(signedBit).hex("123456789"))
  end)

  it("needs the bit operations injected", function()
    assert.has_error(function() Crc32.new(nil) end)
    assert.has_error(function() Crc32.new({ band = purebit.band }) end)
  end)

  it("formats hex as eight lowercase digits", function()
    assert.are.equal("0000000f", Crc32.toHex(15))
    assert.are.equal("ffffffff", Crc32.toHex(-1))
  end)
end)
