#!/bin/sh
# Builds addon/dist/ToadsBank-<version>.zip (and the Slice 0 probe as ToadsBankProbe-<version>.zip).
# The version comes from $VERSION, else `git describe`; each .toc gets that version and the interface number that
# addon/clients.lua gives its flavour (docs/adr/0004-client-targets.md). Run from anywhere: sh addon/pack.sh
# Needs lua5.1 (or lua) and zip; docker/compose.test.yaml's addon-pack service has both.
set -eu

ADDON_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(cd "$ADDON_DIR/.." && pwd)
DIST="$ADDON_DIR/dist"
BUILD="$DIST/build"

LUA=${LUA:-}
if [ -z "$LUA" ]; then
  for candidate in lua5.1 lua luajit; do
    if command -v "$candidate" >/dev/null 2>&1; then
      LUA=$candidate
      break
    fi
  done
fi
[ -n "$LUA" ] || { echo "pack.sh: needs lua5.1 (or lua) on PATH" >&2; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "pack.sh: needs zip on PATH" >&2; exit 1; }

if [ -z "${VERSION:-}" ]; then
  VERSION=$(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || echo "0.0.0-dev")
fi
VERSION=$(printf '%s' "$VERSION" | sed 's/^v//; s/[^A-Za-z0-9._-]/-/g' | cut -c1-32)
[ -n "$VERSION" ] || VERSION="0.0.0-dev"

# Replaces a "## Name:" line in a .toc, portably (no sed -i).
stamp() {
  file=$1 name=$2 value=$3
  sed "s|^## $name:.*|## $name: $value|" "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

rm -rf "$BUILD"
mkdir -p "$BUILD"
cp -R "$ADDON_DIR/ToadsBank" "$BUILD/ToadsBank"
cp -R "$ADDON_DIR/probe/ToadsBankProbe" "$BUILD/ToadsBankProbe"

# "<toc> <interface> <flavour>" per client target.
CLIENTS="$ADDON_DIR/clients.lua" "$LUA" -e '
  local clients = dofile(os.getenv("CLIENTS"))
  local names = {}
  for name in pairs(clients) do names[#names + 1] = name end
  table.sort(names)
  for _, name in ipairs(names) do
    local c = clients[name]
    assert(type(c.toc) == "string" and type(c.interface) == "number", "bad client entry " .. name)
    print(c.toc .. " " .. string.format("%d", c.interface) .. " " .. name)
  end
' > "$BUILD/clients.txt"

while read -r toc interface flavour; do
  for addon in ToadsBank ToadsBankProbe; do
    target="$BUILD/$addon/$(printf '%s' "$toc" | sed "s/^ToadsBank/$addon/")"
    [ -f "$target" ] || { echo "pack.sh: $target (flavour $flavour) is missing" >&2; exit 1; }
    stamp "$target" Interface "$interface"
  done
  echo "pack.sh: $flavour -> $toc, interface $interface"
done < "$BUILD/clients.txt"

for toc in "$BUILD"/ToadsBank/*.toc "$BUILD"/ToadsBankProbe/*.toc; do
  stamp "$toc" Version "$VERSION"
done

mkdir -p "$DIST"
rm -f "$DIST/ToadsBank-$VERSION.zip" "$DIST/ToadsBankProbe-$VERSION.zip"
(cd "$BUILD" && zip -qr "$DIST/ToadsBank-$VERSION.zip" ToadsBank && zip -qr "$DIST/ToadsBankProbe-$VERSION.zip" ToadsBankProbe)
rm -rf "$BUILD"
echo "pack.sh: wrote $DIST/ToadsBank-$VERSION.zip and $DIST/ToadsBankProbe-$VERSION.zip"
