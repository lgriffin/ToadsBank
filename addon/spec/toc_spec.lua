-- The .toc files and clients.lua agree (docs/adr/0004-client-targets.md): one file list for every flavour, every
-- addon file listed, the interface each .toc carries matching clients.lua, the version left for pack.sh to stamp.
local Loader = require("spec.helpers.loader")

local function readLines(path)
  local lines = {}
  local handle = assert(io.open(path, "r"))
  for line in handle:lines() do
    lines[#lines + 1] = line
  end
  handle:close()
  return lines
end

local function directive(path, name)
  for _, line in ipairs(readLines(path)) do
    local value = line:match("^## " .. name .. ":%s*(.-)%s*$")
    if value then
      return value
    end
  end
end

describe("client targets", function()
  local clients = dofile("clients.lua")

  it("has a .toc per flavour with the interface from clients.lua", function()
    local count = 0
    for flavour, client in pairs(clients) do
      local toc = "ToadsBank/" .. client.toc
      assert.are.equal(tostring(client.interface), directive(toc, "Interface"), flavour)
      assert.are.equal("@version@", directive(toc, "Version"), flavour)
      assert.are.equal("ToadsBankDB", directive(toc, "SavedVariables"), flavour)
      count = count + 1
    end
    assert.truthy(clients.forever and clients.tbc)
    assert.are.equal(20505, clients.tbc.interface)
    assert.are.equal(2, count)
  end)

  it("lists the same files in every .toc, each of which exists", function()
    local reference = Loader.tocFiles("ToadsBank/" .. clients.forever.toc)
    for _, client in pairs(clients) do
      assert.are.same(reference, Loader.tocFiles("ToadsBank/" .. client.toc))
    end
    for _, file in ipairs(reference) do
      local handle = io.open("ToadsBank/" .. file, "r")
      assert.truthy(handle, file .. " is listed but missing")
      handle:close()
    end
    assert.are.equal("Bootstrap.lua", reference[#reference])
  end)

  it("lists every Lua file in the addon", function()
    local listed = {}
    for _, file in ipairs(Loader.tocFiles()) do
      listed[file] = true
    end
    local listing = io.popen("cd ToadsBank && find . -name '*.lua' | sed 's|^./||' | sort")
    for file in listing:lines() do
      assert.truthy(listed[file], file .. " is not in the .toc")
    end
    listing:close()
  end)
end)
