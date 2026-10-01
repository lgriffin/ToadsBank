# Lua 5.1, busted and luacheck for addon-test, so the addon is testable without a local Lua install.
FROM ubuntu:24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends lua5.1 liblua5.1-0-dev luarocks build-essential zip ca-certificates git unzip \
 && luarocks install busted 2.2.0-1 \
 && luarocks install luacheck 1.2.0-1 \
 && apt-get purge -y build-essential && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /work
