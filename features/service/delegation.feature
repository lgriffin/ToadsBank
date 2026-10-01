Feature: Members the hub vouches for as uploaders or managers
  The hub lets officers grant chosen members the bank's upkeep: importing snapshots, or running the request queue.
  On each call it checks the grant itself and vouches for it with the `uploader` or `manager` role and the banks the
  call may touch (X-Toads-Banks). The role acts on those banks alone, never on an officers-only bank the member cannot
  see, and brings no officer or admin powers.

  Background:
    Given Leigh is an admin
    And the bank "Toads main" is registered with manager "Gob"
    And "Toads main" was observed holding 20 "Super Mana Potion" in tab 1
    And Uma is an uploader
    And Mo is a manager
    And the hub vouches for Uma on "Toads main"
    And the hub vouches for Mo on "Toads main"

  @TB-BM-17
  Scenario: TB-BM-17 A vouched uploader imports a bank they do not manage
    When the clock moves on 1 hours
    And Uma imports an export of "Toads main" with tab 1 holding 30 "Super Mana Potion"
    Then Leigh sees 30 "Super Mana Potion" observed

  @TB-BM-17
  Scenario: TB-BM-17 A vouched manager approves a request on a bank they are not listed on
    Given Frog has requested 10 "Super Mana Potion" from "Toads main"
    When Mo approves Frog's request
    Then the request is "approved"
    And Mo's queue lists 1 request

  @TB-BM-17
  Scenario: TB-BM-17 A manager works only the banks the hub names on the call
    Given the bank "Toads alts" is registered with manager "Gob"
    And "Toads alts" was observed holding 20 "Super Mana Potion" in tab 1
    And Frog has requested 10 "Super Mana Potion" from "Toads alts"
    When Mo approves Frog's request
    Then the call fails with "forbidden"
    And Mo's queue lists 0 requests

  @TB-BM-17
  Scenario: TB-BM-17 A manager never works an officers-only bank, even one the hub names
    Given the officers-only bank "Toads vault" is registered with manager "Gob"
    And "Toads vault" was observed holding 20 "Super Mana Potion" in tab 1
    And the hub vouches for Mo on "Toads vault"
    And Gob has requested 10 "Super Mana Potion" from "Toads vault"
    When Mo approves Gob's request
    Then the call fails with "forbidden"
    And Mo's queue lists 0 requests

  @TB-BM-17
  Scenario: TB-BM-17 An uploader cannot run the request queue
    Given Frog has requested 10 "Super Mana Potion" from "Toads main"
    When Uma approves Frog's request
    Then the call fails with "forbidden"

  @TB-BM-17
  Scenario: TB-BM-17 A manager cannot import
    When Mo imports an export of "Toads main" with tab 1 holding 30 "Super Mana Potion"
    Then the call fails with "forbidden"

  @TB-BM-17
  Scenario: TB-BM-17 Neither role brings admin powers
    When Mo registers the bank "Toads alt"
    Then the call fails with "forbidden"
    When Uma registers the bank "Toads alt"
    Then the call fails with "forbidden"
