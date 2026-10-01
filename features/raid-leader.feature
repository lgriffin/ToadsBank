# Scenarios for requirements/raid-leader.ears. Tag every scenario with its EARS ID.
# @pending scenarios have no steps yet: add steps and drop @pending when the requirement is built.
# @verified-elsewhere scenarios are checked by a test outside Cucumber that names the ID (scripts/trace.ts).
Feature: Raid leader

  @TB-RL-01 @pending
  Scenario: TB-RL-01 The service shall store a raid profile with timezone, recurrence, managers and item templates

  @TB-RL-02 @pending
  Scenario: TB-RL-02 When a raid occurrence is created, the service shall give it its own allocations and copy none from earlier occurrences

  @TB-RL-03 @pending
  Scenario: TB-RL-03 The service shall count each physical bank once in the holistic view, whatever raid views draw on it

  @TB-RL-04 @pending
  Scenario: TB-RL-04 If an allocation would commit more than the eligible projected stock, then the service shall reject it

  @TB-RL-05 @pending
  Scenario: TB-RL-05 When a request draws on a raid allocation, the service shall reduce raid availability and leave general availability unchanged

  @TB-RL-06 @pending
  Scenario: TB-RL-06 When a raid occurrence expires, the service shall release unused commitments under the configured policy and write an audit event

  @TB-RL-07 @pending
  Scenario: TB-RL-07 The service shall report shortfall per target as max(0, target - eligibleAvailable), allocating free stock once across competing targets

  @TB-RL-08 @pending
  Scenario: TB-RL-08 Where a raid uses a dedicated physical bank, the service shall show it beside virtual allocations in the raid view
