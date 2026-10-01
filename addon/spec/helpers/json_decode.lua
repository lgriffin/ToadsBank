-- A small strict JSON decoder for the specs, to read the invalid contract fixtures back. Arrays come back marked with
-- the given array function (JsonEncoder.array) so they re-encode as arrays. Not shipped in the addon.
return function(text, array)
  local pos = 1
  local byte, sub, char = string.byte, string.sub, string.char

  local function fail(message)
    error("json_decode: " .. message .. " at byte " .. pos, 0)
  end

  local function skip()
    while true do
      local b = byte(text, pos)
      if b == 32 or b == 9 or b == 10 or b == 13 then
        pos = pos + 1
      else
        return
      end
    end
  end

  local function utf8(code)
    if code < 0x80 then
      return char(code)
    elseif code < 0x800 then
      return char(0xC0 + math.floor(code / 64), 0x80 + code % 64)
    end
    return char(0xE0 + math.floor(code / 4096), 0x80 + math.floor(code / 64) % 64, 0x80 + code % 64)
  end

  local ESC = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }

  local value

  local function str()
    pos = pos + 1
    local out = {}
    while true do
      local c = sub(text, pos, pos)
      if c == "" then
        fail("unterminated string")
      elseif c == '"' then
        pos = pos + 1
        return table.concat(out)
      elseif c == "\\" then
        local e = sub(text, pos + 1, pos + 1)
        if e == "u" then
          out[#out + 1] = utf8(tonumber(sub(text, pos + 2, pos + 5), 16) or fail("bad \\u escape"))
          pos = pos + 6
        else
          out[#out + 1] = ESC[e] or fail("bad escape")
          pos = pos + 2
        end
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
  end

  function value()
    skip()
    local c = sub(text, pos, pos)
    if c == "{" then
      pos = pos + 1
      local obj = {}
      skip()
      if sub(text, pos, pos) == "}" then
        pos = pos + 1
        return obj
      end
      while true do
        skip()
        if sub(text, pos, pos) ~= '"' then
          fail("expected a key")
        end
        local key = str()
        skip()
        if sub(text, pos, pos) ~= ":" then
          fail("expected :")
        end
        pos = pos + 1
        obj[key] = value()
        skip()
        local d = sub(text, pos, pos)
        pos = pos + 1
        if d == "}" then
          return obj
        elseif d ~= "," then
          fail("expected , or }")
        end
      end
    elseif c == "[" then
      pos = pos + 1
      local arr = array({})
      skip()
      if sub(text, pos, pos) == "]" then
        pos = pos + 1
        return arr
      end
      while true do
        arr[#arr + 1] = value()
        skip()
        local d = sub(text, pos, pos)
        pos = pos + 1
        if d == "]" then
          return arr
        elseif d ~= "," then
          fail("expected , or ]")
        end
      end
    elseif c == '"' then
      return str()
    elseif sub(text, pos, pos + 3) == "true" then
      pos = pos + 4
      return true
    elseif sub(text, pos, pos + 4) == "false" then
      pos = pos + 5
      return false
    elseif sub(text, pos, pos + 3) == "null" then
      pos = pos + 4
      return nil
    end
    local number = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
    if not number or number == "" then
      fail("unexpected character")
    end
    pos = pos + #number
    return tonumber(number)
  end

  local result = value()
  skip()
  if pos <= #text then
    fail("trailing text")
  end
  return result
end
