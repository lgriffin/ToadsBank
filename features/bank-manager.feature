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

  @TB-BM-12 @pending
  Scenario: TB-BM-12 If a manager DM fails, then the service shall keep the assignment, retry within limits and notify the fallback channel
