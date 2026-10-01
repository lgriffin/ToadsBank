Feature: Raid planning
  Background:
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And "Toads main" was observed holding 100 "Super Mana Potion" in tab 1

  @TB-RL-01
  Scenario: TB-RL-01 A raid profile stores its timezone, recurrence, managers and item templates
    When Leigh creates the raid profile "Kara" in "Europe/Paris" every "Wednesday 20:00" managed by "Rai" wanting 30 "Super Mana Potion"
    Then the raid profile "Kara" has timezone "Europe/Paris", recurrence "Wednesday 20:00", 1 manager and 1 template

  @TB-RL-02
  Scenario: TB-RL-02 A new raid night copies no allocations from the last one
    Given a raid "Kara" starting tomorrow wants 30 "Super Mana Potion"
    And Leigh allocates 20 "Super Mana Potion" from "Toads main" to "Kara"
    When Leigh schedules the next "Kara" night a week later
    Then the next "Kara" night has no allocations and wants 30 "Super Mana Potion"

  @TB-RL-04
  Scenario: TB-RL-04 An allocation beyond projected stock is refused
    Given a raid "Kara" starting tomorrow wants 30 "Super Mana Potion"
    And Frog has requested 50 "Super Mana Potion" from "Toads main"
    When Leigh allocates 60 "Super Mana Potion" from "Toads main" to "Kara"
    Then the call fails with "over_allocated"

  @TB-RL-05
  Scenario: TB-RL-05 A raid request draws on the raid's allocation and leaves general stock alone
    Given a raid "Kara" starting tomorrow wants 30 "Super Mana Potion"
    And Leigh allocates 30 "Super Mana Potion" from "Toads main" to "Kara"
    When Frog requests 10 "Super Mana Potion" from "Toads main" for "Kara"
    Then the request is "reserved"
    And "Kara" can still draw 20 "Super Mana Potion"
    And Frog sees 70 "Super Mana Potion" available

  @TB-RL-06
  Scenario: TB-RL-06 An expired raid releases unused commitments and leaves an audit event
    Given a raid "Kara" starting tomorrow wants 30 "Super Mana Potion"
    And Leigh allocates 30 "Super Mana Potion" from "Toads main" to "Kara"
    And Frog has requested 10 "Super Mana Potion" from "Toads main" for "Kara"
    When the clock moves on 2 days
    And the worker expires raids
    Then Frog sees 90 "Super Mana Potion" available
    And the audit log records "raid.expired"

  @TB-RL-07
  Scenario: TB-RL-07 Free stock is counted once across competing raid targets
    Given the bank "Toads alt" is registered with manager "Gob"
    And a raid "Kara" starting tomorrow wants 80 "Super Mana Potion"
    And a raid "Gruul" starting in two days wants 50 "Super Mana Potion"
    Then "Kara" is short 0 "Super Mana Potion"
    And "Gruul" is short 30 "Super Mana Potion"

  @TB-RL-08
  Scenario: TB-RL-08 A raid's dedicated bank is shown beside its allocations
    Given the bank "Kara bank" is registered with manager "Gob"
    And "Kara bank" was observed holding 12 "Flask of Relentless Assault" in tab 1
    And a raid "Kara" with dedicated bank "Kara bank" starting tomorrow wants 30 "Super Mana Potion"
    Then the "Kara" view shows dedicated bank "Kara bank" with 12 "Flask of Relentless Assault"
