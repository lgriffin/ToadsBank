-- Canonical JSON (contracts/transport.md, Payload step 1): object keys sorted by byte, no whitespace, integers only,
-- strings escaped as JSON.stringify does, everything else as raw bytes. The same value always gives the same bytes.
--
-- Lua tables have no array/object distinction, so arrays are tables marked with JsonEncoder.array(t); every other
-- table is an object whose keys must all be strings. An empty marked table encodes as [], an unmarked one as {}.
local _, ns = ...

local JsonEncoder = {}

local format, byte, concat, floor = string.format, string.byte, table.concat, math.floor
local type, pairs, next, getmetatable, setmetatable = type, pairs, next, getmetatable, setmetatable

local ARRAY_META = { __name = "ToadsBank.JsonArray" }

-- Marks t (or a new table) as a JSON array and returns it.
function JsonEncoder.array(t)
  return setmetatable(t or {}, ARRAY_META)
end

function JsonEncoder.isArray(t)
  return type(t) == "table" and getmetatable(t) == ARRAY_META
end

local ESCAPES = {
  ['"'] = '\\"',
  ["\\"] = "\\\\",
  ["\b"] = "\\b",
  ["\f"] = "\\f",
  ["\n"] = "\\n",
  ["\r"] = "\\r",
  ["\t"] = "\\t",
}

local function escapeChar(c)
  return ESCAPES[c] or format("\\u%04x", byte(c))
end

local function encodeString(s)
  return '"' .. s:gsub('[%z\1-\31"\\]', escapeChar) .. '"'
end

-- Largest integer a double holds exactly (2^53).
local MAX_EXACT = 9007199254740992

local function encodeNumber(n, path)
  if n ~= n or n == math.huge or n == -math.huge then
    error("JsonEncoder: " .. path .. " is not a finite number", 0)
  end
  if n ~= floor(n) then
    error("JsonEncoder: " .. path .. " is not an integer (" .. tostring(n) .. ")", 0)
  end
  if n > MAX_EXACT or n < -MAX_EXACT then
    error("JsonEncoder: " .. path .. " is outside the exact integer range", 0)
  end
  if n > -2147483648 and n < 2147483648 then
    return format("%d", n)
  end
  return format("%.0f", n)
end

-- Byte order, independent of the C locale (Lua's < on strings uses strcoll).
local function byteLess(a, b)
  local la, lb = #a, #b
  local n = la < lb and la or lb
  for i = 1, n do
    local x, y = byte(a, i), byte(b, i)
    if x ~= y then
      return x < y
    end
  end
  return la < lb
end
JsonEncoder.byteLess = byteLess

local encodeValue

local function encodeArray(t, path, out, depth)
  local count = 0
  for _ in pairs(t) do
    count = count + 1
  end
  for i = 1, count do
    if t[i] == nil then
      error("JsonEncoder: " .. path .. " is an array with holes or non-index keys", 0)
    end
  end
  out[#out + 1] = "["
  for i = 1, count do
    if i > 1 then
      out[#out + 1] = ","
    end
    encodeValue(t[i], path .. "[" .. i .. "]", out, depth + 1)
  end
  out[#out + 1] = "]"
end

local function encodeObject(t, path, out, depth)
  local keys = {}
  for k in pairs(t) do
    if type(k) ~= "string" then
      error("JsonEncoder: " .. path .. " has a non-string key (mark arrays with JsonEncoder.array)", 0)
    end
    keys[#keys + 1] = k
  end
  table.sort(keys, byteLess)
  out[#out + 1] = "{"
  for i = 1, #keys do
    local k = keys[i]
    if i > 1 then
      out[#out + 1] = ","
    end
    out[#out + 1] = encodeString(k)
    out[#out + 1] = ":"
    encodeValue(t[k], path .. "." .. k, out, depth + 1)
  end
  out[#out + 1] = "}"
end

local MAX_DEPTH = 32

function encodeValue(v, path, out, depth)
  local kind = type(v)
  if kind == "string" then
    out[#out + 1] = encodeString(v)
  elseif kind == "number" then
    out[#out + 1] = encodeNumber(v, path)
  elseif kind == "boolean" then
    out[#out + 1] = v and "true" or "false"
  elseif kind == "table" then
    if depth > MAX_DEPTH then
      error("JsonEncoder: " .. path .. " nests too deeply (cycle?)", 0)
    end
    if getmetatable(v) == ARRAY_META then
      encodeArray(v, path, out, depth)
    elseif next(v) == nil then
      out[#out + 1] = "{}"
    else
      encodeObject(v, path, out, depth)
    end
  else
    error("JsonEncoder: " .. path .. " has unsupported type " .. kind, 0)
  end
end

-- Returns the canonical JSON text of v; raises an error for values JSON (or this contract) cannot carry.
function JsonEncoder.encode(v)
  local out = {}
  encodeValue(v, "$", out, 0)
  return concat(out)
end

ns.JsonEncoder = JsonEncoder
