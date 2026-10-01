# Transport grammar TOADSBANK/1

The addon cannot make network calls, so a snapshot travels as text: the player copies it out of WoW and pastes it
into a Discord modal (or the site's import box). This file is the contract both sides implement; the fixtures in
`fixtures/` are its executable form.

## Payload

1. Serialise the snapshot as canonical JSON: object keys sorted by byte, no whitespace, integers only, strings
   escaped as `JSON.stringify` does (`\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, other control characters as
   `\u00xx` with lowercase hex; everything else, including non-ASCII, as raw UTF-8). The same snapshot always gives
   the same bytes.
2. Compute the CRC-32 (IEEE, as zlib) of the whole payload. It detects corruption only and authenticates nothing.
3. Cut the bytes into chunks of **1,269 bytes** (a multiple of 3, so every part's base64 stands alone and only the
   last part is padded). Base64 is cut on bytes, never on characters.

## Part

```
TOADSBANK/1 export=<snapshotId> part=<n>/<N> crc32=<8 lowercase hex>
<standard base64 of chunk n, padded>
```

- `snapshotId` matches `^[A-Za-z0-9-]{8,48}$`, so a header is at most 96 characters with its newline and a whole
  part at most 1,788 characters: under the 1,800 limit (TB-BM-05).
- `n` runs from 1 to `N`; `N` is at most 800 and the decoded payload at most 1 MiB (TB-DM-07).
- The export panel separates parts with a blank line.

## Reading

A reader accepts parts in any order and across several pastes. It ignores text before the first header, blank
lines, Discord code fences and `>` quote markers, and joins a payload that wrapped over several lines. It rejects:

| Case | Code |
| --- | --- |
| A header it cannot read | `bad_header` |
| A transport version other than 1 | `unsupported_version` |
| `n` outside 1..N | `bad_part_number` |
| `N` above 800 | `too_many_parts` |
| Parts whose export id, N or CRC differ | `mixed_exports` |
| The same part twice with different payloads (an identical repeat is fine) | `conflicting_part` |
| Bytes that do not match the CRC | `crc_mismatch` |
| A payload above 1 MiB | `too_large` |

After reassembly the payload must be UTF-8 JSON nested at most 8 deep that validates against
`schema/snapshot.v1.json` and the cross-field rules in its description.

## Versioning

A schema change means a new `schemaVersion`, new fixtures and a service that still reads the old version. A grammar
change means `TOADSBANK/2`.
