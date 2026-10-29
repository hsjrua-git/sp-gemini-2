# A26 production-build sale and void retry

Fresh isolated fixture `Audit POS 1be15d2d1f`; tab
`tab_9bb695ea-acd8-44c2-bf05-c36bd07ca171`, generation 27, Persian, `/cafe` at :5300.
Actual UI product/customer selection, quantity **0.145**, price **100**:
line and total both display **15 Toman**. Native sale click returns **201**,
sale `11b42779-88d9-445d-b93a-ea8b2da6a4ba`, total/COGS **15/15**, balance **−15**.
Request `a7531099-0d47-443f-aca6-236209b6af2b:855`; no console errors.
Independent `sold-readback` confirms stock **0.855** and balanced posted journal.

Native row Void + accepted real confirmation returns **201**, request `:867`,
visible `فروش ابطال شد. مانده جدید: 0 تومان`. A wait for `فروش باطل شد.` timed out
because that is not the actual message; inspection confirmed success, no repeat
mutation. SPA journal navigation displays entry **1119** as voided (GET `:870`).
Its first read `:863` preceded the return by about **50 seconds**: this is live
status evidence, not proof of A27's within-30-second invalidation. A27's four
controlled component checks establish that timing-sensitive behavior.

Independent `voided-readback` and `cleanup-verified` confirm balance **0**, stock
**1**, replayable ledger, balanced journals, archived student and inactive
product/supplier. Append-only purchase/sale/void history remains isolated.
Accidental earlier `/cafe/sales` navigation rendered NotFound; `/cafe` is the route.
