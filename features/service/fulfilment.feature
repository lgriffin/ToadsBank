Feature: Fulfilling requests and reconciling stock
  Background:
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And "Toads main" was observed holding 20 "Super Mana Potion" in tab 1
    And Frog has requested 10 "Super Mana Potion" from "Toads main"

  @TB-BM-13
  Scenario: TB-BM-13 A delivery reduces the reservation and creates the pending outgoing together
    When Gob approves Frog's request
    And Gob delivers 10 of Frog's request
    Then the request is "fulfilled" with 10 delivered
    And Leigh sees "Super Mana Potion" as observed 20, pending 10, raid held 0, reserved 0, available 10

  @TB-BM-13
  Scenario: TB-BM-13 Only the bank's managers record deliveries
    When Frog delivers 10 of Frog's request
    Then the call fails with "forbidden"

  @TB-BM-14
  Scenario: TB-BM-14 Pending outgoing stays unavailable until a later observation covers it
    Given Gob has delivered 10 of Frog's request
    When Gob imports an export of "Toads main" with tab 1 holding 10 "Super Mana Potion" and tab 2 unknown
    Then Leigh sees "Super Mana Potion" as observed 10, pending 10, raid held 0, reserved 0, available 0
    When the clock moves on 1 hours
    And Gob imports an export of "Toads main" with tab 1 holding 10 "Super Mana Potion"
    Then Leigh sees "Super Mana Potion" as observed 10, pending 0, raid held 0, reserved 0, available 10

  @TB-BM-15
  Scenario: TB-BM-15 A matching drop is labelled consistent with reported movement, and nobody is named
    Given Gob has delivered 10 of Frog's request
    When the clock moves on 1 hours
    And Gob imports an export of "Toads main" with tab 1 holding 10 "Super Mana Potion"
    Then the stock review for "Super Mana Potion" says "consistent_with_reported_movement"
    And the stock review names no member

  @TB-BM-15
  Scenario: TB-BM-15 A drop with no delivery behind it is flagged for review
    When the clock moves on 1 hours
    And Gob imports an export of "Toads main" with tab 1 holding 5 "Super Mana Potion"
    Then the stock review for "Super Mana Potion" says "unexplained_decrease"

  @TB-BM-16
  Scenario: TB-BM-16 An action carrying a stale revision is refused with the current state
    Given Gob approves Frog's request
    When Gob rejects Frog's request using the revision from before the approval
    Then the call fails with "stale_revision" showing the request as "approved"
