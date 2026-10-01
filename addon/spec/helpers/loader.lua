-- Loads addon files the way WoW does: each file gets ("ToadsBank", ns) as its varargs and registers into the shared
-- ns table. The file list comes from the .toc, so a file missing from it fails the specs too.
local Loader = {}

Loader.ADDON = "ToadsBank"
Loader.DIR = "ToadsBank/"
Loader.TOC = "ToadsBank/ToadsBank.toc"

function Loader.tocFiles(tocPath)
  local files = {}
  local handle = assert(io.open(tocPath or Loader.TOC, "r"))
  for line in handle:lines() do
    line = line:gsub("\r$", ""):gsub("^%s+", ""):gsub("%s+$", "")
    if line ~= "" and not line:match("^#") then
      files[#files + 1] = line
    end
  end
  handle:close()
  return files
end

-- Runs one addon file. env, when given, becomes the file's global environment (a fake WoW API for adapters).
function Loader.loadFile(relativePath, ns, env)
  local chunk = assert(loadfile(Loader.DIR .. relativePath))
  if env then
    setfenv(chunk, env)
  end
  chunk(Loader.ADDON, ns)
  return ns
end

-- A fresh ns with every core/ file loaded, in .toc order, with no WoW environment at all.
function Loader.core()
  local ns = {}
  for _, file in ipairs(Loader.tocFiles()) do
    if file:match("^core/") then
      Loader.loadFile(file, ns, setmetatable({}, { __index = _G }))
    end
  end
  return ns
end

-- core plus the named adapter files, the adapters loaded against env (whose __index should reach _G).
function Loader.withAdapters(env, adapterFiles)
  local ns = Loader.core()
  for _, file in ipairs(adapterFiles) do
    Loader.loadFile(file, ns, env)
  end
  return ns
end

return Loader
