-- A toadsbank.snapshot v1 (contracts/schema/snapshot.v1.json) as a plain Lua table. Lists are plain sequences here;
-- the export marks them as JSON arrays. Strings are cut to the schema's limits on UTF-8 boundaries.
local _, ns = ...

local Snapshot = {}

Snapshot.SCHEMA = "toadsbank.snapshot"
Snapshot.SCHEMA_VERSION = 1
Snapshot.ID_PATTERN = "^[A-Za-z0-9%-]+$"
Snapshot.ID_MIN, Snapshot.ID_MAX = 8, 48

local floor, byte, format = math.floor, string.byte, string.format

-- Number of UTF-8 characters (bytes that are not continuation bytes).
function Snapshot.length(s)
  local n = 0
  for i = 1, #s do
    local b = byte(s, i)
    if b < 128 or b >= 192 then
      n = n + 1
    end
  end
  return n
end

-- s cut to at most maxChars UTF-8 characters, never inside a character.
function Snapshot.truncate(s, maxChars)
  if type(s) ~= "string" then
    return ""
  end
  local n = 0
  for i = 1, #s do
    local b = byte(s, i)
    if b < 128 or b >= 192 then
      n = n + 1
      if n > maxChars then
        return s:sub(1, i - 1)
      end
    end
  end
  return s
end

local function idPart(s)
  return (tostring(s or ""):lower():gsub("[^a-z0-9]", ""))
end

-- realm-character-epoch-xxxx in lowercase, only [a-z0-9-], at most 48 characters: the realm and character are
-- shortened first so the epoch and the 16-bit random suffix always survive.
function Snapshot.makeId(realm, character, epoch, random16)
  local suffix = format("%d-%04x", floor(epoch), floor(random16 or 0) % 65536)
  local prefix = {}
  local r, c = idPart(realm), idPart(character)
  if r ~= "" then
    prefix[#prefix + 1] = r
  end
  if c ~= "" then
    prefix[#prefix + 1] = c
  end
  local head = table.concat(prefix, "-")
  local room = Snapshot.ID_MAX - #suffix - 1
  if #head > room then
    head = head:sub(1, room):gsub("%-$", "")
  end
  if head == "" then
    return "toadsbank-" .. suffix
  end
  return head .. "-" .. suffix
end

local function flavour(s)
  s = tostring(s or ""):lower():gsub("[^a-z0-9_]", "")
  if s == "" then
    return "unknown"
  end
  return s:sub(1, 24)
end

local function byIndex(a, b)
  return a.index < b.index
end

-- fields: snapshotId, addonVersion, client {flavour, build, interface}, source {guild, realm, region},
-- uploader {name, realm}, capturedAt, completedAt, stable, money (optional), tabs (from Tab.*).
function Snapshot.build(fields)
  local client = fields.client or {}
  local source = fields.source or {}
  local uploader = fields.uploader or {}
  local version = Snapshot.truncate(fields.addonVersion or "", 32)
  local snapshot = {
    schema = Snapshot.SCHEMA,
    schemaVersion = Snapshot.SCHEMA_VERSION,
    snapshotId = fields.snapshotId,
    addon = { version = version ~= "" and version or "0.0.0" },
    client = {
      flavour = flavour(client.flavour),
      build = Snapshot.truncate(tostring(client.build or ""), 32),
      interface = floor(tonumber(client.interface) or 0),
    },
    source = {
      kind = "guildBank",
      guild = Snapshot.truncate(source.guild, 64),
      realm = Snapshot.truncate(source.realm, 64),
      region = Snapshot.truncate(source.region or "", 8),
    },
    uploader = {
      name = Snapshot.truncate(uploader.name, 24),
      realm = Snapshot.truncate(uploader.realm, 64),
    },
    capturedAt = floor(fields.capturedAt),
    completedAt = floor(fields.completedAt),
    stable = fields.stable and true or false,
    tabs = {},
  }
  if type(fields.money) == "number" and fields.money >= 0 and fields.money == floor(fields.money) then
    snapshot.money = fields.money
  end
  for i = 1, #(fields.tabs or {}) do
    snapshot.tabs[i] = fields.tabs[i]
  end
  table.sort(snapshot.tabs, byIndex)
  return snapshot
end

-- Deep copy with no metatables, for storage.
function Snapshot.copy(value)
  if type(value) ~= "table" then
    return value
  end
  local out = {}
  for k, v in pairs(value) do
    out[k] = Snapshot.copy(v)
  end
  return out
end

ns.Snapshot = Snapshot
