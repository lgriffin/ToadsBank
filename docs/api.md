# toadsbank-api HTTP contract, v1

The Toads hub is the only client. Its API calls these routes on behalf of a signed-in member; its bot reaches them
through the hub API, never directly. JSON in and out, UTF-8, times as epoch seconds.

## Auth and identity

Every `/v1` call carries:

| Header | Meaning |
| --- | --- |
| `Authorization: Bearer <TOADSBANK_SERVICE_TOKEN>` | The shared service token. Anything else is `401`. |
| `X-Toads-Member` | The member's Discord id (decimal string). Required. |
| `X-Toads-Name` | Display name, percent-encoded UTF-8. Optional. |
| `X-Toads-Roles` | Comma list from `member`, `officer`, `admin`, `uploader`, `manager`. `admin` is a hub global officer; `uploader` and `manager` are per-call delegations (below). Unknown roles are ignored. |
| `X-Toads-Banks` | Comma list of source ids the hub vouches for on this call; `uploader` and `manager` act on these alone. Optional. |

The hub decides who reaches a route (its RBAC); ToadsBank still applies its own rules to the identity: a source's
`audience` (`members` or `officers`) limits who sees it (TB-GM-04), and manager actions need the member to be in the
source's `managers` or an `admin`.

`uploader` and `manager` let the hub delegate the bank's upkeep to chosen members without making them officers
(TB-BM-17). The hub sends them only on a call it has checked itself (its own grants and raid-day binding), together
with `X-Toads-Banks`, the banks that call may touch. On those banks alone, and only on ones the member may see,
`uploader` lets the member accept a snapshot as an officer could, and `manager` lets them list requests (`scope=queue`
or `scope=all`, narrowed to those banks) and approve, reject, record deliveries on and cancel requests as one of the
source's managers could. Neither reaches an officers-only bank (TB-GM-04), registers or edits sources, plans raids or
commits raid stock, and neither adds the member to a source's `managers`, so `request.assigned` DMs still go to the
listed managers only.

Every mutating `POST` needs an `Idempotency-Key` header (1 to 128 characters). A repeat with the same key and body
returns the first response; the same key with a different body is `409 idempotency_conflict` (TB-DM-06). Actions on
an existing entity send its `expectedRevision`; a stale one is `409 stale_revision` with the current entity in
`error.current` (TB-BM-16).

## Errors

`{ "error": { "code": "...", "message": "...", "details": ..., "current": ... } }`

| Status | Codes |
| --- | --- |
| 400 | `bad_request`, `validation_failed` |
| 401 / 403 / 404 | `unauthorised`, `forbidden`, `not_found` |
| 409 | `stale_revision`, `idempotency_conflict`, `insufficient_stock` (with `details.available` and `details.canWaitlist`), `snapshot_conflict`, `invalid_transition`, `over_allocated` |
| 422 | Import problems: `transport_error` (with `details.code` from contracts/transport.md), `invalid_snapshot` (with `details.issues`), `unknown_source`, `import_expired`, `incomplete` |
| 423 | `source_stale`: the source's latest observation is past the block threshold (TB-GM-08) |

## Health

`GET /health` → `200 {"ok":true}` when the database answers and is migrated, else `503`. No auth.

## Imports (TB-BM-06 to 10, TB-DM-07)

An import session collects pasted parts until the export is complete. Sessions expire 30 minutes after opening and
take at most 800 parts and 1 MiB decoded.

- `POST /v1/imports` → `201 {"id","openedAt","expiresAt"}`
- `POST /v1/imports/{id}/parts` `{"text": "<pasted text, any number of parts>"}` →
  `200 {"exportId","received":[1,2],"total":5,"missing":[3,4,5],"complete":false}`. The text may hold several parts,
  in any order, wrapped in Discord code fences. Bad parts are `422 transport_error`.
- `GET /v1/imports/{id}/preview` → `200 Preview` once complete, else `422 incomplete`.
- `POST /v1/imports/{id}/accept` → `200 Receipt`. Accepting a snapshot id again returns the first receipt with
  `"duplicate": true` when the content is identical, and `409 snapshot_conflict` when it differs (TB-BM-07).

```jsonc
// Preview
{
  "snapshotId": "spineshatter-bankalt-1790799000-a1b2",
  "source": { "guild": "Toads", "realm": "Spineshatter", "region": "EU" },
  "matchedSource": { "id": "src_1", "name": "Toads main bank" },  // null when no registered source matches
  "uploader": { "name": "Bankalt", "realm": "Spineshatter" },
  "client": { "flavour": "forever", "build": "0.0.0", "interface": 0 },
  "capturedAt": 1790799000, "completedAt": 1790799012, "stable": true,
  "tabs": [{ "index": 1, "name": "Potions", "status": "observed", "occupied": 40, "items": 10, "olderThanBaseline": false }],
  "warnings": ["tab 3 was not readable and keeps its previous observation"],
  "existingReceipt": null
}
// Receipt
{ "snapshotId": "...", "sourceId": "src_1", "acceptedAt": 1790799100, "tabsUpdated": [1, 2], "tabsKeptAsHistory": [],
  "tabsNotRead": [3], "duplicate": false }
```

Only the source's managers, officers, admins and a hub-vouched `uploader` may accept. An export from an unregistered bank is
`422 unknown_source` unless an `admin` accepts it, which registers the source (audience `members`, the accepting
admin as manager).

## Sources (TB-BM-10)

One physical bank is one source, whoever uploads it: guild bank sources are keyed by guild, realm and region.

- `GET /v1/sources` → `200 Source[]` (only those the caller may see)
- `POST /v1/sources` (admin) `{"name","guild","realm","region","audience","raidDay","managers":[ids]}` → `201 Source`
- `PATCH /v1/sources/{id}` (admin) `{"expectedRevision", ...fields}` → `200 Source`

```jsonc
{ "id": "src_1", "revision": 3, "name": "Toads main bank", "kind": "guildBank", "guild": "Toads",
  "realm": "Spineshatter", "region": "EU", "audience": "members", "raidDay": null, "managers": ["1234"],
  "lastObservedAt": 1790799012, "freshness": "fresh",   // fresh | warn (over 24 h) | stale (over 72 h: no new holds)
  "tabs": [{ "index": 1, "name": "Potions", "status": "observed", "observedAt": 1790799004, "capacity": 98 }] }
```

## Inventory (TB-GM-01 to 04, TB-RL-03)

- `GET /v1/sources/{id}/replica` → the bank as captured, tab by tab and slot by slot (TB-GM-01):
  `{"source": Source, "tabs": [{"index","name","status","observedAt","capacity","slots":[{"slot","itemId","name","count","link"}]}]}`
- `GET /v1/inventory?q=<name filter>&sourceId=<id>` → every item across the sources the caller may see, each bank
  counted once (TB-RL-03):

```jsonc
{ "range": { "oldest": 1790700000, "newest": 1790799012 },   // capture-time range of the aggregate (TB-GM-03)
  "items": [{ "itemId": 22832, "name": "Super Mana Potion",
    "observed": 40, "pendingOutgoing": 5, "raidHeld": 10, "directReserved": 4, "available": 21,
    "sources": [{ "sourceId": "src_1", "observed": 40, "pendingOutgoing": 5, "raidHeld": 10, "directReserved": 4,
                  "available": 21, "observedAt": 1790799004 }] }] }
```

`available = observed - pendingOutgoing - raidHeld - directReserved`, never below zero.

## Requests (TB-GM-05 to 09, TB-BM-11 to 16)

States: `reserved` (holds stock) → `approved` → `fulfilled`; `waitlisted` holds nothing; any open state can end in
`cancelled`, `rejected` or `expired`. Deliveries may be partial.

- `POST /v1/requests` `{"sourceId","itemId","quantity","character","note","occurrenceId"?, "waitlist"?: true}` →
  `201 Request`. The quantity is reserved atomically or the call fails with `409 insufficient_stock`; resending with
  `"waitlist": true` creates a waitlisted request (TB-GM-06). `423 source_stale` when the source is too old.
- `GET /v1/requests?scope=mine|queue|all&status=<state>` → `Request[]`. `queue` is what the caller manages.
- `POST /v1/requests/{id}/cancel` `{"expectedRevision"}` (the requester, a manager or admin) → releases only the
  outstanding quantity; recorded deliveries stay (TB-GM-07).
- `POST /v1/requests/{id}/approve|reject` `{"expectedRevision","note"?}` (manager).
- `POST /v1/requests/{id}/deliveries` `{"expectedRevision","quantity"}` (manager) → reduces the reservation and
  creates the pending outgoing in one transaction (TB-BM-13).

```jsonc
{ "id": "req_1", "revision": 2, "status": "approved", "memberId": "5678", "memberName": "Frogger",
  "character": "Frogmage", "sourceId": "src_1", "itemId": 22832, "itemName": "Super Mana Potion", "quantity": 5,
  "delivered": 0, "outstanding": 5, "occurrenceId": null, "note": "for Kara", "managerNote": null,
  "managers": ["1234"], "createdAt": 1790800000, "updatedAt": 1790800100 }
```

## Stock reviews (TB-BM-14, TB-BM-15)

When an accepted observation shows an item dropping, the service records a review. A drop that matches deliveries
the observation covers is labelled `consistent_with_reported_movement` and closed; any other drop is
`unexplained_decrease` and stays open. Reviews never name who took anything.

- `GET /v1/reviews?sourceId=&open=true` (officers) → `Review[]`
  `{"id","sourceId","itemId","itemName","snapshotId","before","after","reported","label","resolved","resolvedBy","resolution","createdAt"}`
- `POST /v1/reviews/{id}/resolve` `{"resolution"}` (manager) → `Review`

## Raids (TB-RL-01 to 08)

- `GET /v1/raid-profiles`, `POST /v1/raid-profiles` (officers)
  `{"name","timezone","recurrence","managers":[ids],"templates":[{"itemId","target"}],"sourceIds":[],"dedicatedSourceIds":[]}`
- `POST /v1/raid-profiles/{id}/occurrences` `{"name"?,"startsAt","expiresAt"?}` → a raid night with its own, empty
  allocations and the profile's targets (TB-RL-02)
- `GET /v1/occurrences?profileId=`, `GET /v1/occurrences/{id}` → the raid view, built only from the banks the caller
  may see (TB-GM-04); each target takes free stock once, earliest raid first, from the banks its profile may draw on:
  `{"occurrence","profile","allocations":[{...,"raidAvailable"}],"targets":[{"itemId","target","allocated","freeAssigned","eligibleAvailable","shortfall"}],"dedicated":[{"sourceId","name","items"}]}`
- `POST /v1/occurrences/{id}/allocations` `{"sourceId","itemId","quantity"}` → `409 over_allocated` beyond general
  availability (TB-RL-04). The bank must be one the caller can see (else `404`) and, unless they are an officer, one
  they manage (else `403`); the raid must still be active (else `409 invalid_transition`)
- `POST /v1/occurrences/{id}/allocations/{allocationId}/release` `{"quantity"}`

A request with `occurrenceId` draws on that raid's allocation and leaves general availability unchanged (TB-RL-05).
The raid night must exist (`404`) and be active (`409 invalid_transition`), waitlisted or not. Its raid's managers join
the request's `managers` only when the bank's audience is `members`.
When a raid night expires, the worker releases what open raid requests do not hold and writes an audit event
(TB-RL-06).

## Events to the hub (TB-DM-09, TB-BM-11, TB-BM-12)

The worker delivers every outbox event to `TOADSBANK_EVENTS_URL` as
`POST {"id","type","occurredAt","payload"}` with the service token. A `2xx` acknowledges it; anything else is retried
with backoff for up to 24 hours. Delivery is at least once, so the hub dedupes on `id`. Events never re-import.

| Type | Payload | Hub reaction |
| --- | --- | --- |
| `snapshot.accepted` | `{source, receipt, uploader}` | refresh dashboards, post to the bank channel |
| `request.created` | `{request}` | list in the queue |
| `request.assigned` | `{request, managers}` | DM each manager; on DM failure keep the assignment, retry, then post to the fallback channel |
| `request.updated` | `{request, change}` (`approved`, `rejected`, `cancelled`, `delivered`, `fulfilled`, `expired`) | DM the requester, edit dashboards |
| `raid.expired` | `{occurrenceId, name, released}` | tell the raid's managers what went back to general stock |

Names in payloads are raw; the hub escapes them and suppresses mentions in every bot message (TB-DM-08).
