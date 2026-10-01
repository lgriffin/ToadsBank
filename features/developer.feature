# Scenarios for requirements/developer.ears. Tag every scenario with its EARS ID.
# @pending scenarios have no steps yet: add steps and drop @pending when the requirement is built.
# @verified-elsewhere scenarios are checked by a test outside Cucumber that names the ID (scripts/trace.ts).
Feature: Developer and maintainer

  @TB-DM-02 @verified-elsewhere
  Scenario: TB-DM-02 The addon's domain and serialization modules shall run under standalone Lua with no WoW client
    Given only a standalone Lua 5.1 interpreter and no WoW client
    When the addon specs run
    Then every core module (domain, application, serialization, ports) loads and passes its specs
    And the core reads no global outside Lua's standard library, as luacheck and the bytecode check confirm

  @TB-DM-03 @verified-elsewhere
  Scenario: TB-DM-03 The Lua and TypeScript codebases shall validate against the same checked-in contract fixtures
    Given the checked-in fixtures under contracts/fixtures
    When the Lua specs and the TypeScript contract tests run
    Then both turn the golden snapshot into exactly golden/snapshot.canonical.json, crc32.txt and parts.txt
    And both reject the schema-stage invalid fixtures for the same reasons

  @TB-DM-04 @verified-elsewhere
  Scenario: TB-DM-04 Where the client lacks guild-bank capability, the addon shall report the source as unsupported and shall not scan
    Given a client whose API lacks the guild bank functions
    When the bank manager starts a scan
    Then the addon reports the source as unsupported
    And it lists and queries no tab and stores no snapshot

  @TB-DM-05 @pending
  Scenario: TB-DM-05 The stack shall start from a clean clone with one compose command

  @TB-DM-08 @pending
  Scenario: TB-DM-08 The service shall escape imported names and suppress mentions in all bot output

  @TB-DM-11 @pending
  Scenario: TB-DM-11 When a release tag is cut, the pipeline shall publish versioned images and the addon archive from that one tag
