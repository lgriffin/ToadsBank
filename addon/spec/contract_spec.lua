-- The Lua half of the symmetric contract test (TB-DM-03): the addon and the TypeScript service
-- (tests/contract/snapshot-contract.test.ts) both check themselves against contracts/fixtures. From the golden
-- snapshot the addon must produce exactly the canonical bytes, the CRC and the parts, each part within 1,800
-- characters (TB-BM-05); and its Validator must reject the schema-stage invalid fixtures.
local Loader = require("spec.helpers.loader")
local Fixtures = require("spec.helpers.fixtures")
local purebit = require("spec.helpers.purebit")
local decodeJson = require("spec.helpers.json_decode")

describe("contract fixtures (TB-DM-03)", function()
  local ns, golden, cases

  before_each(function()
    ns = Loader.core()
    golden = Fixtures.goldenSnapshot(ns.JsonEncoder.array)
    cases = decodeJson(Fixtures.read("invalid/cases.json"), ns.JsonEncoder.array)
  end)

  it("canonical JSON of golden/snapshot.lua is byte for byte golden/snapshot.canonical.json", function()
    assert.are.equal(Fixtures.read("golden/snapshot.canonical.json"), ns.JsonEncoder.encode(golden))
  end)

  it("the CRC-32 of the payload is golden/crc32.txt", function()
    local crc = ns.Crc32.new(purebit).hex(Fixtures.read("golden/snapshot.canonical.json"))
    assert.are.equal((Fixtures.read("golden/crc32.txt"):gsub("%s+$", "")), crc)
  end)

  it("the export parts are golden/parts.txt, each at most 1,800 characters (TB-BM-05)", function()
    local export = ns.ExportSnapshot.encode(golden, purebit)
    assert.are.equal(Fixtures.read("golden/parts.txt"), ns.ExportChunker.join(export.parts) .. "\n")
    for _, part in ipairs(export.parts) do
      assert.truthy(#part <= 1800, "part is " .. #part .. " characters")
    end
  end)

  it("exports the same bytes from a stored copy that lost its array marks", function()
    local stored = ns.Snapshot.copy(golden)
    local export = ns.ExportSnapshot.encode(stored, purebit)
    assert.are.equal(Fixtures.read("golden/snapshot.canonical.json"), export.payload)
  end)

  it("the golden parts decode back to the canonical payload", function()
    local parts = Fixtures.parseParts(Fixtures.read("golden/parts.txt"))
    local chunks = {}
    for _, part in ipairs(parts) do
      assert.are.equal(golden.snapshotId, part.id)
      assert.are.equal(#parts, part.total)
      chunks[part.n] = ns.Base64.decode(part.payload)
    end
    assert.are.equal(Fixtures.read("golden/snapshot.canonical.json"), table.concat(chunks))
  end)

  it("the Validator accepts the golden snapshot", function()
    local ok, issues = ns.Validator.validate(golden, cases.now)
    assert.is_true(ok, issues and ns.Validator.describe(issues))
  end)

  local SCHEMA_MESSAGES = {
    duplicate_slot = "duplicates slot",
    future_timestamp = "is in the future",
    string_length = "must be a string of 1 to 24 characters", -- UTF-16 code units, as JavaScript counts them
  }

  it("the Validator rejects each schema-stage invalid fixture with the service's reason", function()
    local checked, expected = 0, 0
    for _, case in ipairs(cases.cases) do
      if case.stage == "schema" then
        expected = expected + 1
        local parts = Fixtures.parseParts(Fixtures.read("invalid/" .. case.file))
        local chunks = {}
        for _, part in ipairs(parts) do
          chunks[part.n] = ns.Base64.decode(part.payload)
        end
        local payload = table.concat(chunks)
        assert.are.equal(parts[1].crc32, ns.Crc32.new(purebit).hex(payload))
        local snapshot = decodeJson(payload, ns.JsonEncoder.array)
        local ok, issues = ns.Validator.validate(snapshot, cases.now)
        assert.is_false(ok, case.file)
        assert.matches(SCHEMA_MESSAGES[case.code], ns.Validator.describe(issues))
        checked = checked + 1
      end
    end
    assert.are.equal(expected, checked)
    assert.truthy(checked >= 3)
  end)
end)
