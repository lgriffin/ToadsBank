-- JsonEncoder: canonical JSON per contracts/transport.md (TB-DM-02: runs under plain Lua 5.1, no WoW client).
local Loader = require("spec.helpers.loader")

describe("JsonEncoder (TB-DM-02)", function()
  local ns, J

  before_each(function()
    ns = Loader.core()
    J = ns.JsonEncoder
  end)

  it("sorts object keys by byte and writes no whitespace", function()
    local value = { b = { y = false, x = true }, a = 3, _ = 2, A = 1 }
    assert.are.equal('{"A":1,"_":2,"a":3,"b":{"x":true,"y":false}}', J.encode(value))
  end)

  it("sorts keys by byte, not by locale", function()
    assert.are.equal('{"Z":1,"a":2,"\195\169":3}', J.encode({ ["\195\169"] = 3, a = 2, Z = 1 }))
    assert.is_true(J.byteLess("ab", "abc"))
    assert.is_false(J.byteLess("b", "a"))
  end)

  it("escapes strings as JSON.stringify does", function()
    assert.are.equal('"q\\"b\\\\s\\bf\\fn\\nr\\rt\\t"', J.encode('q"b\\s\bf\fn\nr\rt\t'))
    assert.are.equal('"\\u0000\\u0001\\u001f\\u000b"', J.encode("\0\1\31\11"))
  end)

  it("writes other bytes raw, including non-ASCII, DEL and slash", function()
    assert.are.equal('"P\195\182tions/\127|cff"', J.encode("P\195\182tions/\127|cff"))
  end)

  it("writes integers with no exponent or decimal point", function()
    local numbers = J.array({ 0, -7, 123456789, 2147483648, 4102444800 })
    assert.are.equal("[0,-7,123456789,2147483648,4102444800]", J.encode(numbers))
  end)

  it("refuses non-integers, NaN and infinities", function()
    assert.has_error(function() J.encode(1.5) end)
    assert.has_error(function() J.encode(0 / 0) end)
    assert.has_error(function() J.encode(math.huge) end)
    assert.has_error(function() J.encode({ a = 0.1 }) end)
  end)

  it("encodes marked arrays, including empty ones, and unmarked empty tables as objects", function()
    assert.are.equal("[]", J.encode(J.array({})))
    assert.are.equal("{}", J.encode({}))
    local nested = { slots = J.array(), tabs = J.array({ { a = 1 }, J.array() }) }
    assert.are.equal('{"slots":[],"tabs":[{"a":1},[]]}', J.encode(nested))
    assert.is_true(J.isArray(J.array()))
    assert.is_false(J.isArray({}))
  end)

  it("refuses arrays with holes and objects with non-string keys", function()
    assert.has_error(function() J.encode(J.array({ 1, nil, 3 })) end)
    assert.has_error(function() J.encode(J.array({ 1, x = 2 })) end)
    assert.has_error(function() J.encode({ 1, 2 }) end)
  end)

  it("encodes booleans and refuses functions", function()
    assert.are.equal('{"f":false,"t":true}', J.encode({ t = true, f = false }))
    assert.has_error(function() J.encode({ f = print }) end)
  end)

  it("gives the same bytes for the same value however it was built", function()
    local a = { z = 1, y = J.array({ { b = 2, a = 1 } }) }
    local b = {}
    b.y = J.array({ { a = 1, b = 2 } })
    b.z = 1
    assert.are.equal(J.encode(a), J.encode(b))
  end)
end)
