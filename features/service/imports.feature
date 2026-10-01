Feature: Importing pasted snapshots
  Players copy a snapshot out of WoW in parts and paste them into Discord or the site. The service rebuilds it,
  checks it and applies it to the bank it belongs to.

  Background:
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"

  @TB-BM-06
  Scenario: TB-BM-06 Parts pasted out of order are reassembled, checked and previewed
    Given an export of "Toads main" holding 40 "Super Mana Potion" in tab 1
    When Gob pastes the parts in reverse order
    Then the import is complete
    And the preview shows tab 1 with 40 occupied slots

  @TB-BM-06
  Scenario: TB-BM-06 A corrupted part is refused with its transport code
    Given an export of "Toads main" holding 40 "Super Mana Potion" in tab 1
    When Gob pastes the parts with one character changed
    And Gob previews the import
    Then the call fails with "transport_error"

  @TB-BM-07
  Scenario: TB-BM-07 The same export imported twice returns the first receipt
    Given an export of "Toads main" holding 40 "Super Mana Potion" in tab 1
    And Gob imports it
    When Gob imports it again
    Then the receipt is marked as a duplicate
    And "Toads main" has had 1 snapshot accepted

  @TB-BM-07
  Scenario: TB-BM-07 A different export under a used snapshot id is refused
    Given an export of "Toads main" holding 40 "Super Mana Potion" in tab 1
    And Gob imports it
    When Gob imports a changed export with the same snapshot id
    Then the call fails with "snapshot_conflict"

  @TB-BM-08
  Scenario: TB-BM-08 An older snapshot becomes history and leaves the baseline alone
    Given "Toads main" was observed holding 40 "Super Mana Potion" in tab 1
    When Gob imports an export of "Toads main" captured an hour earlier holding 10 "Super Mana Potion" in tab 1
    Then tab 1 of "Toads main" was kept as history
    And Leigh sees 40 "Super Mana Potion" observed

  @TB-BM-09 @TB-BM-02
  Scenario: TB-BM-09 A partial snapshot updates only the tabs it read
    Given "Toads main" was observed holding 40 "Major Mana Potion" in tab 2 and 5 "Haste Potion" in tab 1
    When the clock moves on 2 hours
    And Gob imports an export of "Toads main" with tab 1 holding 8 "Haste Potion" and tab 2 unknown
    Then Leigh sees 40 "Major Mana Potion" observed
    And Leigh sees 8 "Haste Potion" observed
    And tab 2 of "Toads main" is marked as not currently read and keeps its age

  @TB-BM-10
  Scenario: TB-BM-10 Exports of one bank by different uploaders resolve to one source
    Given Mira is an officer
    And "Toads main" was observed holding 40 "Super Mana Potion" in tab 1
    When Mira imports an export of "Toads main" with tab 1 holding 30 "Super Mana Potion"
    Then there is 1 bank
    And Leigh sees 30 "Super Mana Potion" observed

  @TB-BM-10
  Scenario: TB-BM-10 A member who is neither manager nor officer cannot upload
    Given Frog is a member
    When Frog imports an export of "Toads main" with tab 1 holding 30 "Super Mana Potion"
    Then the call fails with "forbidden"

  @TB-DM-07
  Scenario: TB-DM-07 An import session ends after 30 minutes
    Given an export of "Toads main" holding 40 "Super Mana Potion" in tab 1
    And Gob opens an import
    When the clock moves on 31 minutes
    And Gob pastes the parts into the open import
    Then the call fails with "import_expired"

  @TB-DM-09
  Scenario: TB-DM-09 An accepted snapshot publishes one event, and delivery retries without re-importing
    Given an export of "Toads main" holding 40 "Super Mana Potion" in tab 1
    And Gob imports it
    And the hub is down for 1 delivery
    When the worker delivers the outbox
    And the clock moves on 2 minutes
    And the worker delivers the outbox
    Then the hub received 1 "snapshot.accepted" event
    And "Toads main" has had 1 snapshot accepted
