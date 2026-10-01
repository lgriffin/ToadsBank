-- Driving side: /toadsbank (alias /tbank) scan | export | status | abort.
local _, ns = ...

local SlashCommands = {}

SlashCommands.USAGE = "/toadsbank scan | export | status | abort  (alias /tbank)"

-- Routes one command line to app = {scan, export, status, abort, print}. Pure, so the specs can drive it.
function SlashCommands.dispatch(input, app)
  local command = tostring(input or ""):lower():match("^%s*(%S*)") or ""
  if command == "scan" then
    app.scan()
  elseif command == "export" then
    app.export()
  elseif command == "status" then
    app.status()
  elseif command == "abort" or command == "stop" then
    app.abort()
  else
    app.print(SlashCommands.USAGE)
    return false
  end
  return true
end

function SlashCommands.register(app)
  SLASH_TOADSBANK1 = "/toadsbank"
  SLASH_TOADSBANK2 = "/tbank"
  SlashCmdList.TOADSBANK = function(input)
    SlashCommands.dispatch(input, app)
  end
end

ns.SlashCommands = SlashCommands
