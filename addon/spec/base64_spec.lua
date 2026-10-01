-- Base64 (standard alphabet, padded), TB-DM-02.
local Loader = require("spec.helpers.loader")

describe("Base64 (TB-DM-02)", function()
  local B

  before_each(function()
    B = Loader.core().Base64
  end)

  it("encodes the RFC 4648 test vectors", function()
    local vectors = { [""] = "", f = "Zg==", fo = "Zm8=", foo = "Zm9v", foob = "Zm9vYg==", fooba = "Zm9vYmE=",
      foobar = "Zm9vYmFy" }
    for plain, encoded in pairs(vectors) do
      assert.are.equal(encoded, B.encode(plain))
      assert.are.equal(plain, B.decode(encoded))
    end
  end)

  it("uses + and / and round-trips every byte value", function()
    local all = {}
    for i = 0, 255 do
      all[#all + 1] = string.char(i)
    end
    local bytes = table.concat(all)
    assert.are.equal("+/8=", B.encode("\251\255"))
    assert.are.equal(bytes, B.decode(B.encode(bytes)))
  end)

  it("rejects malformed text", function()
    assert.is_nil(B.decode("abc"))
    assert.is_nil(B.decode("ab=c"))
    assert.is_nil(B.decode("Zg==Zg=="))
    assert.is_nil(B.decode("Z!=="))
  end)
end)
