# Actual cafe browser lifecycle — 2026-10-29

Isolated API/SPA `http://127.0.0.1:3300`, disposable sample-admin session,
Persian/RTL viewport **480 × 597**. Fixture `Audit POS 68a993272d` was created
by `checks/browser-finance-fixture.mjs prepare`. Command evidence is retained
with unique names in this directory.

## Purchase and sale

The actual purchase form was filled with the synthetic supplier/product,
quantity **1**, unit cost **100** and an audit note. The displayed total was
100 Toman. POST `/api/cafe/purchases` returned **201**, purchase
`daf9406d-bf26-4b93-8a57-a1121b6f9083`, `total:"100.000"`. The form reset and
showed `خرید از «Audit POS 68a993272d» به مبلغ 100 تومان ثبت شد.`

On `/cafe`, selected Student, searched and picked the synthetic student
(`90744d41-9d2e-4efd-8ed0-51d39965bc8b`, code JW5YUH9H), added the product,
and filled quantity **0.145**, unit price **100**. At
`2026-10-29T18:46:16.964Z`, DOM input values were exactly `0.145` and `100`;
both the line amount and cart total read **14 تومان**. Student balance was 0.
Document horizontal overflow was zero.

Submitting the real form issued POST `/api/cafe/sales` with:

```json
{"customer":"student","items":[{"productId":"a26f74de-c576-4384-a625-cb58acbc8545","qty":0.145,"unitPrice":100}],"studentId":"90744d41-9d2e-4efd-8ed0-51d39965bc8b","note":"Audit POS 68a993272d quote regression"}
```

HTTP **201**, sale `fd08f656-8762-49a0-ba5c-76016e454b5e`, `total:"15"`,
`costTotal:"15"`, `balanceAfter:-15`. The cart cleared; the chosen student
showed **−15** and the debt badge. Success text read
`فروش ثبت شد. مانده جدید: -15 تومان`; today's sale row showed **15 تومان**.
This establishes A26's pre-submit quote / actual charge mismatch.

Independent authenticated API readback (`browser-finance-sold-readback`) shows:

- Purchase +1, sale −0.145, remaining stock **0.855**, average cost 100.
- Sale-linked balance charge **−15**, resulting balance **−15**.
- Purchase journal 1036: inventory Dr100, cash Cr100.
- Sale journal 1037: deposits Dr15 / revenue Cr15 and COGS Dr15 / inventory Cr15;
  debit and credit totals both **30**. Both entries were posted.

## Void and cleanup

Activated the synthetic sale row's Void control. Native confirm was observed:
`این فروش ابطال شود؟ موجودی محصول‌ها و ماندهٔ دانش‌آموز برمی‌گردد.`
The dialog closed before the agent's subsequent accept call; that call reported
no remaining dialog. The already-completed browser request proves the action:
POST `/api/cafe/sales/fd08f656-8762-49a0-ba5c-76016e454b5e/void` returned
**201**, `{"voided":true,"balanceAfter":0}`. No repeat submission was made.
The row changed to voided, its button disappeared, pinned balance became 0,
and `فروش ابطال شد. مانده جدید: 0 تومان` appeared. The earlier sale-success
message remains visible with historical −15; this observation is not a separate
finding. Error-level browser console capture was empty.

Independent `browser-finance-void-readback` confirms refund **+15** to 0,
stock **1** after a +0.145 sale_void movement, voided sale journal, and the
still-posted purchase journal. `browser-finance-cleanup` asserts zero balance
and stock equal to retained purchases, deactivates product/supplier, archives
the student, and marks the fixture cleaned. Append-only history is retained.

`browser-finance-cleanup-verify-02` independently confirms the final inactive
entities, zero balance, charge/refund replay, restored stock and balanced journals.
The first verifier invocation incorrectly expected an archived student's balance
API to return 200; its 404 is expected product behavior, not a finding. The
corrected verifier inspects that archived balance through SELECT-only pinned SQL
after fresh schema inspection (`balance-schema`). The original failed harness
output is preserved. MCP was rechecked and still points to the unrelated
port-5432 database, so the agreed isolated fallback was used.

## Harness limitations

Pointer `browser.click` returned `UnknownVizError` without issuing a request.
After checking actual state/network, DOM `.click()` on the existing controls
was used; React handlers, validation, mutations and actual HTTP were exercised.
This is not proof of pointer hit-testing. One purchase wait used the wrong
contiguous Persian phrase and timed out despite a completed successful request;
subsequent DOM/network inspection confirmed success without resubmitting.
