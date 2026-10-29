# A21 live retry — 2026-10-30 local time

Production bundle at `127.0.0.1:5300` via the isolated API `:3300` and database
`:55439/student_panel_audit`. Viewport measured **1233×887**, Persian/RTL.
Baseline `client/dist` preserved. Native checkbox/fill/select tools and keyboard
Enter submitted the real form; DOM focus selected the save button. This does
not establish pointer hit-testing.

Fixture: `Audit UI c3126ae889`, parameter
`3697dc61-e21e-4e96-85b5-a306f7bdf499`, member
`18307f7a-6008-48d4-a8a0-15312787f175`.

| Mode | Session | Quality / quantity | PUT request suffix | Result |
|---|---|---|---|---|
| Administrator, individual | `befbb19d-ac8e-40af-9032-9c757a3b97ef` | 8 / 4 | `:630` | 200, changed 1 |
| Blind, group member | `317f90db-97d8-4159-bd1f-84de82c9375a` | 6 / 1 | `:640` | 200, changed 1 |
| Blind, individual | `befbb19d-ac8e-40af-9032-9c757a3b97ef` | 5 / 0 | `:643` | 200, changed 1 |

Captured request prefix: `a7531099-0d47-443f-aca6-236209b6af2b`. Bodies contain
the stated session/member/parameter and values, selected true, null comments.
Each response contains the same session and `changed:1`. UI displayed the
translated saved/one-cell message. The individual grid had **one** row, and the
blind group grid **three** (whole group + two members). Blind individual fields
were empty before entry despite existing 8/4; no evaluation GET occurred during
either blind workflow. Independent Administrator HTTP reads retained in
`browser-sighted-readback.txt` and `browser-blind-readback.txt` confirm all values.

Console contained only the initial unauthenticated `/api/auth/me` 401, with no
application exception during these workflows. One focus invocation used an
invalid browser-tool expression; it failed before submission, was corrected to
the documented element callback, and the request log confirms one save.
The earlier login wait timeout searched for the wrong Persian heading; login
itself returned 200. The immediate zero-row observation following selection was
transient loading; settled state rendered correctly.

The disposable viewer role was restored (`browser-role-restored.txt`). Shared
fixture cleanup is recorded with A22 after the import retry.
