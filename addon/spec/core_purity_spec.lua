-- TB-DM-02: the core (domain, application, serialization, ports) runs under standalone Lua with no WoW client, so it
-- may read no global beyond Lua 5.1's own. luacheck enforces the same in CI; this spec checks the compiled
-- bytecode's global accesses with luac, where luac is available.
local Loader = require("spec.helpers.loader")

local ALLOWED = {}
for name in ("assert error ipairs next pairs pcall rawequal rawget rawset select setmetatable getmetatable"
  .. " tonumber tostring type unpack xpcall math string table"):gmatch("%S+") do
  ALLOWED[name] = true
end

local function luac()
  for _, candidate in ipairs({ "luac5.1", "luac" }) do
    local probe = io.popen("command -v " .. candidate .. " 2>/dev/null")
    local path = probe:read("*l")
    probe:close()
    if path and path ~= "" then
      local version = io.popen(candidate .. " -v 2>&1")
      local text = version:read("*a") or ""
      version:close()
      if text:find("5.1", 1, true) then
        return candidate
      end
    end
  end
end

describe("core purity (TB-DM-02)", function()
  local compiler = luac()

  it("loads every core file with an empty global environment", function()
    local ns = Loader.core()
    for _, name in ipairs({ "JsonEncoder", "Base64", "Crc32", "ExportChunker", "Snapshot", "Tab", "Slot", "Validator",
      "ScanCoordinator", "ExportSnapshot", "Ports" }) do
      assert.is_not_nil(ns[name], name)
    end
  end)

  if not compiler then
    pending("luac 5.1 is not on PATH, so the bytecode global check is skipped (luacheck covers it)")
    return
  end

  it("reads and writes no global outside Lua 5.1's standard library", function()
    local offenders = {}
    for _, file in ipairs(Loader.tocFiles()) do
      if file:match("^core/") then
        local listing = io.popen(compiler .. " -p -l " .. Loader.DIR .. file)
        for line in listing:lines() do
          local op, name = line:match("([GS]ETGLOBAL).-; (%S+)")
          if op and (op == "SETGLOBAL" or not ALLOWED[name]) then
            offenders[#offenders + 1] = file .. ": " .. op .. " " .. name
          end
        end
        listing:close()
      end
    end
    assert.are.same({}, offenders)
  end)
end)
