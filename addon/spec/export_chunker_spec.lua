-- ExportChunker: TOADSBANK/1 parts of at most 1,800 characters (TB-BM-05), cut on 1,269-byte chunks.
local Loader = require("spec.helpers.loader")

describe("ExportChunker (TB-BM-05)", function()
  local ns, C

  before_each(function()
    ns = Loader.core()
    C = ns.ExportChunker
  end)

  it("writes one part for a small payload, with the header grammar", function()
    local parts = C.split("{}", "abcdefgh-1", "0123abcd")
    assert.are.equal(1, #parts)
    assert.are.equal("TOADSBANK/1 export=abcdefgh-1 part=1/1 crc32=0123abcd\ne30=", parts[1])
  end)

  it("cuts on 1,269 bytes so only the last part is padded", function()
    local payload = string.rep("x", 1269 * 2 + 1)
    local parts = C.split(payload, "abcdefgh-1", "00000000")
    assert.are.equal(3, #parts)
    for n, part in ipairs(parts) do
      local header, body = part:match("^([^\n]+)\n(.+)$")
      assert.are.equal("TOADSBANK/1 export=abcdefgh-1 part=" .. n .. "/3 crc32=00000000", header)
      if n < 3 then
        assert.are.equal(1692, #body)
        assert.is_nil(body:find("=", 1, true))
      end
      assert.are.equal(payload:sub((n - 1) * 1269 + 1, n * 1269), ns.Base64.decode(body))
    end
    assert.are.equal("eA==", parts[3]:match("\n(.+)$"))
  end)

  it("keeps the longest possible part within 1,800 characters", function()
    local id = string.rep("a", 48)
    local parts = C.split(string.rep("\255", 1269 * 800), id, "ffffffff")
    assert.are.equal(800, #parts)
    for _, part in ipairs(parts) do
      assert.truthy(#part <= 1800, "part is " .. #part .. " characters")
    end
  end)

  it("refuses more than 800 parts and bad headers", function()
    assert.has_error(function() C.split(string.rep("x", 1269 * 800 + 1), "abcdefgh", "00000000") end)
    assert.has_error(function() C.split("x", "short", "00000000") end)
    assert.has_error(function() C.split("x", "has space!", "00000000") end)
    assert.has_error(function() C.split("x", "abcdefgh", "XYZ") end)
    assert.has_error(function() C.split("", "abcdefgh", "00000000") end)
  end)

  it("joins parts with a blank line for the export panel", function()
    assert.are.equal("a\n\nb", C.join({ "a", "b" }))
  end)
end)
