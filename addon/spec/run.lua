-- A tiny stand-in for busted, for machines without luarocks: `cd addon && lua5.1 spec/run.lua [files...]`.
-- Implements only what the specs use (describe, it, pending, before_each, after_each and the luassert calls below),
-- with busted's semantics, so CI's real busted runs the same files unchanged.
package.path = "./?.lua;./?/init.lua;" .. package.path


local function fmt(v)
  if type(v) == "string" then
    return string.format("%q", v)
  end
  return tostring(v)
end

local function deepSame(a, b, seen)
  if a == b then
    return true
  end
  if type(a) ~= "table" or type(b) ~= "table" then
    return false
  end
  seen = seen or {}
  if seen[a] == b then
    return true
  end
  seen[a] = b
  for k, v in pairs(a) do
    if not deepSame(v, b[k], seen) then
      return false
    end
  end
  for k in pairs(b) do
    if a[k] == nil then
      return false
    end
  end
  return true
end

local function failure(message, level)
  error({ assertion = true, message = message }, (level or 1) + 2)
end

local checks = {}
function checks.equal(expected, actual, message)
  if expected ~= actual then
    failure((message and message .. ": " or "") .. "expected " .. fmt(expected) .. ", got " .. fmt(actual))
  end
end
function checks.same(expected, actual, message)
  if not deepSame(expected, actual) then
    failure((message and message .. ": " or "") .. "tables differ")
  end
end
function checks.is_true(v, message)
  if v ~= true then
    failure((message and message .. ": " or "") .. "expected true, got " .. fmt(v))
  end
end
function checks.is_false(v, message)
  if v ~= false then
    failure((message and message .. ": " or "") .. "expected false, got " .. fmt(v))
  end
end
function checks.is_nil(v, message)
  if v ~= nil then
    failure((message and message .. ": " or "") .. "expected nil, got " .. fmt(v))
  end
end
function checks.is_not_nil(v, message)
  if v == nil then
    failure((message and message .. ": " or "") .. "expected a value, got nil")
  end
end
function checks.truthy(v, message)
  if not v then
    failure((message and message .. ": " or "") .. "expected truthy, got " .. fmt(v))
  end
end
function checks.falsy(v, message)
  if v then
    failure((message and message .. ": " or "") .. "expected falsy, got " .. fmt(v))
  end
end
function checks.has_error(fn, expected)
  local ok, err = pcall(fn)
  if ok then
    failure("expected an error")
  end
  if expected ~= nil and err ~= expected then
    failure("expected error " .. fmt(expected) .. ", got " .. fmt(err))
  end
end
function checks.matches(pattern, actual, message)
  if type(actual) ~= "string" or not actual:find(pattern) then
    failure((message and message .. ": " or "") .. "expected " .. fmt(actual) .. " to match " .. fmt(pattern))
  end
end
function checks.not_equal(expected, actual, message)
  if expected == actual then
    failure((message and message .. ": " or "") .. "expected a value other than " .. fmt(expected))
  end
end

local assertion = setmetatable({}, {
  __call = function(_, v, message, ...)
    if not v then
      failure(message or "assertion failed!")
    end
    return v, message, ...
  end,
})
assertion.are = { equal = checks.equal, equals = checks.equal, same = checks.same }
assertion.are_not = { equal = checks.not_equal, equals = checks.not_equal }
assertion.is = { ["true"] = checks.is_true, ["false"] = checks.is_false, ["nil"] = checks.is_nil }
assertion.equal, assertion.equals, assertion.same = checks.equal, checks.equal, checks.same
assertion.are_equal, assertion.are_same = checks.equal, checks.same
assertion.is_true, assertion.is_false, assertion.is_nil = checks.is_true, checks.is_false, checks.is_nil
assertion.is_not_nil = checks.is_not_nil
assertion.truthy, assertion.is_truthy = checks.truthy, checks.truthy
assertion.falsy, assertion.is_falsy = checks.falsy, checks.falsy
assertion.has_error, assertion.has = checks.has_error, { error = checks.has_error }
assertion.error, assertion.errors = checks.has_error, checks.has_error
assertion.matches = checks.matches

-- Collect.
local root = { name = "", children = {}, before = {}, after = {} }
local current = root
local tests = {}

local function describe(name, body)
  local block = { name = name, parent = current, children = {}, before = {}, after = {} }
  local outer = current
  current = block
  body()
  current = outer
end

local function it(name, body)
  tests[#tests + 1] = { block = current, name = name, body = body }
end

local function pending(name)
  tests[#tests + 1] = { block = current, name = name, pending = true }
end

local function fullName(test)
  local names = { test.name }
  local block = test.block
  while block and block.name ~= "" do
    table.insert(names, 1, block.name)
    block = block.parent
  end
  return table.concat(names, " ")
end

local function chain(block)
  local blocks = {}
  while block do
    table.insert(blocks, 1, block)
    block = block.parent
  end
  return blocks
end

local function newEnv()
  local env = setmetatable({}, { __index = _G })
  env.describe, env.it, env.pending = describe, it, pending
  env.before_each = function(fn)
    current.before[#current.before + 1] = fn
  end
  env.after_each = function(fn)
    current.after[#current.after + 1] = fn
  end
  env.assert = assertion
  return env
end

local files = { ... }
if #files == 0 then
  local listing = io.popen("find spec -name '*_spec.lua' | sort")
  for line in listing:lines() do
    files[#files + 1] = line
  end
  listing:close()
end

local helper = loadfile("spec/helpers/init.lua")
if helper then
  helper()
end

local loadErrors = {}
for _, file in ipairs(files) do
  local chunk, err = loadfile(file)
  if not chunk then
    loadErrors[#loadErrors + 1] = err
  else
    setfenv(chunk, newEnv())
    current = { name = "", children = {}, before = {}, after = {}, parent = nil, file = file }
    local ok, runErr = pcall(chunk)
    if not ok then
      loadErrors[#loadErrors + 1] = file .. ": " .. tostring(runErr)
    end
  end
end

local passed, failed, skipped = 0, 0, 0
local failures = {}
for _, test in ipairs(tests) do
  if test.pending then
    skipped = skipped + 1
    io.write("-")
  else
    local blocks = chain(test.block)
    local ok, err = pcall(function()
      for _, block in ipairs(blocks) do
        for _, fn in ipairs(block.before) do
          fn()
        end
      end
      test.body()
    end)
    for i = #blocks, 1, -1 do
      for _, fn in ipairs(blocks[i].after) do
        local afterOk, afterErr = pcall(fn)
        if ok and not afterOk then
          ok, err = false, afterErr
        end
      end
    end
    if ok then
      passed = passed + 1
      io.write(".")
    else
      failed = failed + 1
      io.write("F")
      if type(err) == "table" and err.assertion then
        err = err.message
      end
      failures[#failures + 1] = fullName(test) .. "\n    " .. tostring(err)
    end
  end
end
io.write("\n")
for _, f in ipairs(failures) do
  print("FAIL " .. f)
end
for _, e in ipairs(loadErrors) do
  print("ERROR " .. e)
end
print(string.format("%d passed, %d failed, %d pending, %d load errors (%d files)", passed, failed, skipped,
  #loadErrors, #files))
os.exit((failed == 0 and #loadErrors == 0 and passed > 0) and 0 or 1)
