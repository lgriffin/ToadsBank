# Scenarios for requirements/guild-member.ears. Tag every scenario with its EARS ID.
# @pending scenarios have no steps yet: add steps and drop @pending when the requirement is built.
# @verified-elsewhere scenarios are checked by a test outside Cucumber that names the ID (scripts/trace.ts).
Feature: Guild member

  @TB-GM-01 @pending
  Scenario: TB-GM-01 The service shall show each permitted physical bank as its tabs and slots, in captured slot order

  @TB-GM-02 @pending
  Scenario: TB-GM-02 The service shall show observed, pending outgoing, raid held, direct reserved and general available quantities for every item

  @TB-GM-03 @pending
  Scenario: TB-GM-03 The service shall show the observation age of every source and the capture-time range of every aggregate

  @TB-GM-04 @pending
  Scenario: TB-GM-04 The service shall exclude sources a member may not see from every aggregate shown to that member

  @TB-GM-05 @pending
  Scenario: TB-GM-05 When a member submits a request, the service shall reserve the quantity atomically or reject the request

  @TB-GM-06 @pending
  Scenario: TB-GM-06 If a request exceeds available stock, then the service shall offer a waitlisted request that holds no reservation

  @TB-GM-07 @pending
  Scenario: TB-GM-07 When a member cancels a request, the service shall release only the outstanding quantity and keep recorded deliveries

  @TB-GM-08 @pending
  Scenario: TB-GM-08 While a source's latest observation is older than the review threshold, the service shall block new reservations against it

  @TB-GM-09 @pending
  Scenario: TB-GM-09 The service shall apply the same use cases and stock to requests from the website and from Discord
