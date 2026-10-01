# Scenarios for requirements/developer.ears. Tag every scenario with its EARS ID.
# @pending scenarios have no steps yet: add steps and drop @pending when the requirement is built.
# @verified-elsewhere scenarios are checked by a test outside Cucumber that names the ID (scripts/trace.ts).
Feature: Developer and maintainer

  @TB-DM-01 @pending
  Scenario: TB-DM-01 The domain and application modules shall import no adapter, framework, SQL client, Discord library or Blizzard global

  @TB-DM-02 @pending
  Scenario: TB-DM-02 The addon's domain and serialization modules shall run under standalone Lua with no WoW client

  @TB-DM-03 @pending
  Scenario: TB-DM-03 The Lua and TypeScript codebases shall validate against the same checked-in contract fixtures

  @TB-DM-04 @pending
  Scenario: TB-DM-04 Where the client lacks guild-bank capability, the addon shall report the source as unsupported and shall not scan

  @TB-DM-05 @pending
  Scenario: TB-DM-05 The stack shall start from a clean clone with one compose command

  @TB-DM-06 @pending
  Scenario: TB-DM-06 Every mutating use case shall accept an idempotency key and, where an entity exists, its expected revision

  @TB-DM-07 @pending
  Scenario: TB-DM-07 The service shall reject imports above 1 MiB decoded, 800 parts or a 30-minute session, and bound depth, integers and indices

  @TB-DM-08 @pending
  Scenario: TB-DM-08 The service shall escape imported names and suppress mentions in all bot output

  @TB-DM-09 @pending
  Scenario: TB-DM-09 When a snapshot is accepted, the service shall publish one outbox event; website and Discord updates shall retry without re-importing

  @TB-DM-10 @pending
  Scenario: TB-DM-10 If a pull request adds a capability with no EARS statement and linked scenario, then CI shall fail

  @TB-DM-11 @pending
  Scenario: TB-DM-11 When a release tag is cut, the pipeline shall publish versioned images and the addon archive from that one tag
