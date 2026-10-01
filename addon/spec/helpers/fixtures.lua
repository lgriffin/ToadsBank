-- Reads the shared contract fixtures (contracts/fixtures, TB-DM-03) relative to addon/, where the specs run.
local Fixtures = {}

Fixtures.ROOT = "../contracts/fixtures/"

function Fixtures.read(path)
  local handle = assert(io.open(Fixtures.ROOT .. path, "rb"))
  local text = handle:read("*a")
  handle:close()
  return text
end

-- golden/snapshot.lua is `local A = ...; return {...}`: A marks arrays, so pass JsonEncoder.array.
function Fixtures.goldenSnapshot(array)
  local chunk = assert(loadfile(Fixtures.ROOT .. "golden/snapshot.lua"))
  return chunk(array)
end

-- Splits TOADSBANK/1 text into {header fields, payload} records, in the order given.
function Fixtures.parseParts(text)
  local parts, current = {}, nil
  for line in (text .. "\n"):gmatch("([^\n]*)\n") do
    local id, n, total, crc = line:match("^TOADSBANK/1 export=([%w%-]+) part=(%d+)/(%d+) crc32=(%x+)$")
    if id then
      current = { id = id, n = tonumber(n), total = tonumber(total), crc32 = crc, payload = "" }
      parts[#parts + 1] = current
    elseif current and line ~= "" then
      current.payload = current.payload .. line
    end
  end
  return parts
end

return Fixtures
