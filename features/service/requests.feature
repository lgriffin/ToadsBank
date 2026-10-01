Feature: Requests and reservations
  Background:
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And "Toads main" was observed holding 20 "Super Mana Potion" in tab 1

  @TB-GM-05 @TB-BM-11
  Scenario: TB-GM-05 A request reserves its quantity and is assigned to the bank's manager
    When Frog requests 15 "Super Mana Potion" from "Toads main"
    Then the request is "reserved"
    And Frog sees 5 "Super Mana Potion" available
    And Gob is told about the request
    And Gob's queue lists 1 request

  @TB-GM-05 @TB-GM-06
  Scenario: TB-GM-06 A request beyond available stock is refused with a waitlist offer
    Given Frog has requested 15 "Super Mana Potion" from "Toads main"
    When Toady requests 10 "Super Mana Potion" from "Toads main"
    Then the call fails with "insufficient_stock" offering a waitlist with 5 available
    When Toady waitlists 10 "Super Mana Potion" from "Toads main"
    Then the request is "waitlisted"
    And Frog sees 5 "Super Mana Potion" available

  @TB-GM-07
  Scenario: TB-GM-07 Cancelling releases only what was not yet delivered
    Given Frog has requested 10 "Super Mana Potion" from "Toads main"
    And Gob has delivered 4 of Frog's request
    When Frog cancels the request
    Then the request is "cancelled" with 4 delivered
    And Frog sees 16 "Super Mana Potion" available

  @TB-GM-08
  Scenario: TB-GM-08 No new holds against a bank last observed over 72 hours ago
    Given the clock moves on 73 hours
    When Frog requests 5 "Super Mana Potion" from "Toads main"
    Then the call fails with "source_stale"
    And "Toads main" is "stale"

  @TB-GM-09
  Scenario: TB-GM-09 Requests from the site and from Discord share one stock
    When Frog requests 15 "Super Mana Potion" from "Toads main" on the website
    And Toady requests 10 "Super Mana Potion" from "Toads main" in Discord
    Then the call fails with "insufficient_stock" offering a waitlist with 5 available

  @TB-DM-06
  Scenario: TB-DM-06 A repeated call with the same idempotency key happens once
    When Frog requests 5 "Super Mana Potion" from "Toads main" twice with the same key
    Then Frog has 1 request
    And Frog sees 15 "Super Mana Potion" available

  @TB-DM-06
  Scenario: TB-DM-06 Reusing a key for a different call is refused
    When Frog requests 5 "Super Mana Potion" from "Toads main" with key "abc"
    And Frog requests 6 "Super Mana Potion" from "Toads main" with key "abc"
    Then the call fails with "idempotency_conflict"
