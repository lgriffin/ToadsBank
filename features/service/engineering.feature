Feature: Engineering guarantees
  These are checked by tests outside Cucumber; scripts/trace.ts links each to the test that names its ID.

  @TB-DM-01 @verified-elsewhere
  Scenario: TB-DM-01 The core imports no adapter, framework, SQL client, Discord library or Blizzard global
    Given the source tree of packages/domain, packages/application and packages/adapters
    When the architecture test reads every import
    Then domain imports nothing outside itself
    And application imports only domain and its own ports
    And no adapter imports another adapter
    And a deliberate breach in the fixture tree is reported

  @TB-DM-10 @verified-elsewhere
  Scenario: TB-DM-10 CI fails when a capability has no EARS statement and linked scenario
    Given a scenario that names an unknown requirement, or a statement with no built scenario
    When CI runs the trace check
    Then the check fails and names the problem
    And the count of unlinked statements may only go down
