# CSV preservation probe — 2026-10-29

`score-import-preservation-04.{txt,json}` is the valid product execution:
real PapaParse → `prepareRows` → `guessLayout` → `buildImport` → actual HTTP
dry-run → `planImport` → actual HTTP import save → actual evaluation readback.
It bypasses the React preview renderer because A22 already blocks that screen.
This is not a claim that a browser import was committed.

Initial cell: quality **11**, quantity **22**, and one nonempty comment per
dimension. The cell was restored before each case.

| CSV case | Observed persisted cell | Contract result |
|---|---|---|
| Both dimensions blank | 11 / 22, both comments retained; no entry generated | PASS control |
| Quality-only column = 77 | 77 / null, both comments null | FAIL |
| Quality = 77, mapped quantity blank | 77 / null, both comments null | FAIL |
| Quantity-only column = 66 | null / 66, both comments null | FAIL |
| Both values = 77 / 66, no comment columns | 77 / 66, both comments null | FAIL comment-preservation assertion |

Every actual preview was read-only (full row/timestamp equality); every actual
save returned HTTP 200 and changed=1. The final assertion fails with 4 affected
cases. The values 11/22 are synthetic; scores were removed via authorized bulk
save and fixture entities archived in cleanup.

The UI explicitly promises in both locales that blank cells never clear existing
values (`client/src/i18n/{en,fa}/students.json:213`). Blank/unmapped numeric loss
is therefore a demonstrated contract failure. Comment loss is also demonstrated;
the exact desired comment policy should be included in the repair decision.
The current API is full-cell replacement (`evaluationCheck.js:16-19,66-69`,
`evaluations.js:399-444`); `source:'import'` is only an audit label.

## Retained harness failures and corrections

- `score-import-preservation`: the first run reached the blank-pair control,
  then failed; its cleanup omitted required null dimension fields and masked
  the original exception. Do not count it as product evidence. The exact fixture
  was subsequently recovered by `cleanup-import-fixture` (exit 0).
- `score-import-preservation-02`: reused a parameter display name that remains
  unique after archival; 409 fixture setup failure. Cleanup passed. Added a
  unique suffix to the fixture name.
- `score-import-preservation-03`: incorrectly asserted that Papa's nonfatal
  `UndetectableDelimiter` warning must be absent for tiny two-column inputs.
  Corrected to retain the page's comma fallback, assert comma metadata/row shape,
  and preserve warnings in output. Cleanup passed.
- The first schema command looked for the historical/nonexistent
  `student_parameter_assignments`; psql's later successful commands gave exit 0.
  `import-assignment-schema` separately confirms the real `assignments` table.
  No mutation used the incorrect table name. MCP identity recheck still points
  to port 5432, so all probes use the pinned port-55439 database.
- Context7 resolution returned unrelated libraries for Papa Parse. Its official
  v5 documentation was fetched from https://www.papaparse.com/docs instead.
