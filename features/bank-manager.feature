# Scenarios for requirements/bank-manager.ears. Tag every scenario with its EARS ID.
# @pending scenarios have no steps yet: add steps and drop @pending when the requirement is built.
# @verified-elsewhere scenarios are checked by a test outside Cucumber that names the ID (scripts/trace.ts).
Feature: Bank manager and uploader

  @TB-BM-01 @verified-elsewhere
  Scenario: TB-BM-01 When a scan starts with the bank open, the addon shall query each accessible tab in turn and read slots only after that tab's update signal
    Given the guild bank is open with three viewable tabs
    When the bank manager starts a scan
    Then the addon queries tab 1 and reads no slots until tab 1's update signal has settled
    And it queries the next tab only after reading the previous one, so one tab is in flight at a time
    And a signal for another tab does not count as tab 1's signal
    And the tab count and each tab's capacity come from the client, not from constants

  @TB-BM-02 @verified-elsewhere
  Scenario: TB-BM-02 If a tab is inaccessible or times out, then the addon shall mark it unknown and shall not export it as empty
    Given the guild bank is open with a tab the character cannot view and a tab that never answers its query
    When the bank manager scans
    Then the unviewable tab is marked unknown without being queried
    And the silent tab is queried a bounded number of times, each with a timeout, then marked unknown
    And both export with status "unknown" and no slots, never as empty observed tabs

  @TB-BM-03 @verified-elsewhere
  Scenario: TB-BM-03 If bank contents change during a scan, then the addon shall retry the affected tab or mark the scan unstable
    Given a scan has read tab 1 and is reading tab 2
    When the contents of tab 1 change
    Then the addon queues tab 1 again and exports the re-read contents with stable true
    But if tab 1 keeps changing beyond the retry limit it is exported as "unstable" with no slots
    And the snapshot is exported with stable false

  @TB-BM-04 @verified-elsewhere
  Scenario: TB-BM-04 If the bank closes during a scan, then the addon shall abort and keep the previous completed snapshot
    Given a completed snapshot is stored
    And a new scan is in progress
    When the guild bank window closes
    Then the scan is aborted with reason "bank_closed" and no further tab is queried
    And the stored snapshot is still the previous completed one

  @TB-BM-05 @verified-elsewhere
  Scenario: TB-BM-05 When an export is requested, the addon shall present the snapshot as selectable parts of at most 1,800 characters each
    Given a completed snapshot is stored
    When the bank manager requests an export
    Then the export panel shows the snapshot as TOADSBANK/1 parts, one at a time, each selectable to copy
    And every part is at most 1,800 characters
    And the parts are exactly the ones contracts/fixtures/golden/parts.txt holds for the golden snapshot

  @TB-BM-06 @pending
  Scenario: TB-BM-06 When all parts arrive, the service shall reassemble in any order, verify the CRC32, validate the schema and show a preview

  @TB-BM-07 @pending
  Scenario: TB-BM-07 If a snapshot ID is imported again, then the service shall return the earlier receipt for identical content and reject different content

  @TB-BM-08 @pending
  Scenario: TB-BM-08 If a snapshot is older than a tab's baseline, then the service shall keep it as history and leave the baseline unchanged

  @TB-BM-09 @pending
  Scenario: TB-BM-09 When a partial snapshot is accepted, the service shall update only observed tabs and retain the others at their previous age

  @TB-BM-10 @pending
  Scenario: TB-BM-10 The service shall resolve exports of one physical bank by different uploaders to one source

  @TB-BM-11 @pending
  Scenario: TB-BM-11 When a request is assigned, the service shall notify the manager by DM and list it in the website queue

  @TB-BM-12 @pending
  Scenario: TB-BM-12 If a manager DM fails, then the service shall keep the assignment, retry within limits and notify the fallback channel

  @TB-BM-13 @pending
  Scenario: TB-BM-13 When a delivery is recorded, the service shall reduce the reservation and allocation and create the pending outgoing in one transaction

  @TB-BM-14 @pending
  Scenario: TB-BM-14 While a pending outgoing has no later observation covering it, the service shall keep that quantity unavailable

  @TB-BM-15 @pending
  Scenario: TB-BM-15 The service shall label a matching quantity change as consistent with reported movement and shall not infer who was fulfilled

  @TB-BM-16 @pending
  Scenario: TB-BM-16 If a Discord action carries a stale revision, then the service shall reject it and show current state
