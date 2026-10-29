# Actual membership leave/rejoin workflow — 2026-10-29

Isolated API/SPA port 3300; disposable sample-admin; Persian/RTL 480 × 597.
Fixture `Audit Rejoin fd0ccbfb1e`, student
`98415dfa-8a1f-44fd-a709-b6f85cb86c5d`, group
`ca702897-c64f-4d37-a81b-f8fc8d71002a`.

Opened the fixture group's Members panel, searched the student, activated Add,
then Remove, Re-add on the past membership, and Remove again. All four actual
PUT `/api/groups/:id/members` requests returned **200**, followed by successful
GET refreshes. Existing DOM controls were activated with `.click()` because of
the pointer-host limitation documented in `browser-finance.md`; React and HTTP
paths were real. No direct API mutation substituted for these four actions.

Each stage was independently checked with `checks/browser-group-fixture.mjs`:

| Stage / evidence stem | All membership rows | Open rows |
|---|---:|---:|
| `browser-group-added` | 1 | 1 |
| `browser-group-left` | 1 | 0 |
| `browser-group-rejoined` | 2 | 1 |
| `browser-group-left-again` | 2 | 0 |

The original membership ID is `cacd6638-2ae5-4f56-9248-852637c6369c`; rejoin
created `020059b3-1c21-4dfd-af7a-aae6f4a93667`. Both rows have joined/left dates
2026-10-29 after the final leave. This intentionally tests the same student and
same date pair: distinct membership IDs, rather than student/date fallback,
identify the two historical records.

The real DOM showed exactly **two past-member rows**, no active member, and
the student again available in the add picker. No warning/error console
messages were captured; document horizontal overflow was zero. Production
React does not guarantee development key warnings, so the distinct API IDs and
two retained DOM rows provide the workflow evidence in addition to source review.

`browser-group-cleanup` archives the synthetic group/student and verifies their
inactive state; history remains. Historical audit-notes #21 is now supported
by a successful narrow live workflow, not just the repaired key expression.
