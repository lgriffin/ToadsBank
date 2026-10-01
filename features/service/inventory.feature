Feature: Browsing the bank
  @TB-GM-01
  Scenario: TB-GM-01 A bank is shown as its tabs and slots in captured order
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And "Toads main" was observed holding 40 "Super Mana Potion" and 3 "Haste Potion" in tab 1
    When Frog opens the replica of "Toads main"
    Then the replica shows tab 1 slot 1 holding 40 "Super Mana Potion"
    And the replica shows tab 1 slot 2 holding 3 "Haste Potion"

  @TB-GM-02 @TB-RL-03
  Scenario: TB-GM-02 Every quantity kind is shown per item, each bank counted once
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And the bank "Toads alt" is registered with manager "Gob"
    And "Toads main" was observed holding 100 "Super Mana Potion" in tab 1
    And "Toads alt" was observed holding 50 "Super Mana Potion" in tab 1
    And a raid "Kara" starting tomorrow wants 30 "Super Mana Potion"
    And Leigh allocates 10 "Super Mana Potion" from "Toads main" to "Kara"
    And Frog has requested 5 "Super Mana Potion" from "Toads main"
    And Gob has delivered 2 of Frog's request
    Then Leigh sees "Super Mana Potion" as observed 150, pending 2, raid held 10, reserved 3, available 135

  @TB-GM-03
  Scenario: TB-GM-03 The aggregate shows the capture-time range of its sources
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And the bank "Toads alt" is registered with manager "Gob"
    And "Toads main" was observed holding 100 "Super Mana Potion" in tab 1
    And the clock moves on 3 hours
    And "Toads alt" was observed holding 50 "Super Mana Potion" in tab 1
    Then the inventory's capture range spans 3 hours
    And "Toads main" is "fresh"

  @TB-GM-04
  Scenario: TB-GM-04 An officers-only bank stays out of what a member sees
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And the officers-only bank "Toads vault" is registered with manager "Gob"
    And "Toads main" was observed holding 100 "Super Mana Potion" in tab 1
    And "Toads vault" was observed holding 20 "Super Mana Potion" in tab 1
    Then Frog sees 100 "Super Mana Potion" observed
    And Frog sees 1 bank
    And Leigh sees 120 "Super Mana Potion" observed
