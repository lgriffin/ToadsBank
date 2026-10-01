-- Cuts a payload into TOADSBANK/1 parts (contracts/transport.md, Part). Chunks are 1,269 bytes, a multiple of 3, so
-- every part's base64 stands alone and only the last one is padded; a whole part stays under 1,800 characters
-- (TB-BM-05).
local _, ns = ...

local ExportChunker = {}

ExportChunker.CHUNK_BYTES = 1269
ExportChunker.MAX_PART_CHARS = 1800
ExportChunker.MAX_PARTS = 800
ExportChunker.TRANSPORT = "TOADSBANK/1"
ExportChunker.SEPARATOR = "\n\n"

local format, ceil = string.format, math.ceil

function ExportChunker.header(snapshotId, n, total, crcHex)
  return format("%s export=%s part=%d/%d crc32=%s", ExportChunker.TRANSPORT, snapshotId, n, total, crcHex)
end

-- Returns an array of part strings ("<header>\n<base64>"), in order.
function ExportChunker.split(payload, snapshotId, crcHex)
  assert(type(payload) == "string" and #payload > 0, "ExportChunker.split needs a non-empty payload")
  assert(type(snapshotId) == "string" and snapshotId:match("^[A-Za-z0-9-]+$"), "invalid snapshotId")
  assert(#snapshotId >= 8 and #snapshotId <= 48, "snapshotId must be 8 to 48 characters")
  assert(type(crcHex) == "string" and crcHex:match("^%x%x%x%x%x%x%x%x$"), "crc32 must be 8 hex digits")
  local size = ExportChunker.CHUNK_BYTES
  local total = ceil(#payload / size)
  if total > ExportChunker.MAX_PARTS then
    error("ExportChunker: payload needs " .. total .. " parts, above " .. ExportChunker.MAX_PARTS, 0)
  end
  local encode = ns.Base64.encode
  local parts = {}
  for n = 1, total do
    local chunk = payload:sub((n - 1) * size + 1, n * size)
    local part = ExportChunker.header(snapshotId, n, total, crcHex) .. "\n" .. encode(chunk)
    if #part > ExportChunker.MAX_PART_CHARS then
      error("ExportChunker: part " .. n .. " is " .. #part .. " characters", 0)
    end
    parts[n] = part
  end
  return parts
end

-- The export panel's text for several parts: separated by a blank line.
function ExportChunker.join(parts)
  return table.concat(parts, ExportChunker.SEPARATOR)
end

ns.ExportChunker = ExportChunker
