# Actual browser journal lifecycle — 2026-10-29

Isolated API/SPA `127.0.0.1:3300`, PostgreSQL
`127.0.0.1:55439/student_panel_audit`, disposable `sample-admin`, Persian/RTL,
actual viewport 480 × 597. These are retained observations from the completed
browser execution, supported by the prepare/draft/posted/voided command outputs
in this directory. They are not a subsequent rerun.

## Executed workflow

- Opened the actual journal editor and entered the synthetic memo
  `Audit journal 8f2f76d388`, cash debit and other-income credit using **۳۲۱**.
  Debit 321 / credit 320 disabled submission; matching 321 / 321 enabled it.
- Draft creation returned **HTTP 201**. Entry **1038**,
  `51757ce0-e519-44c7-bc7c-99d5d7dc30fc`, was independently read as `draft` with
  exactly two lines and debit=credit=321. All four posted reports matched baseline.
- The assistant inspected and accepted the posting confirmation. Posting returned
  **HTTP 200**. Independent readback established `posted`, a posting timestamp,
  unchanged line IDs/amounts, and +321 income, profit, assets and cash-ledger balance.
  The browser report displayed income **229321** and profit **41307**.
- The void confirmation opened; the user confirmed it before the assistant could
  inspect the dialog. Exactly one successful void POST was observed, **HTTP 200**.
  Readback established `voided`, retained posting/void timestamps and original lines.
  Trial balance, income statement, balance sheet and cash ledger returned exactly
  to their independently captured baseline responses.

Browser network request prefix: `a7531099-0d47-443f-aca6-236209b6af2b`;
draft `:369`, post `:371`, void `:401`. Draft/post bodies were inspected before
navigation. No credentials, cookies or request headers are retained here.

## Independent controls and settlement

`checks/browser-journal-fixture.mjs` verifies database identity and uses SELECTs
plus actual report GETs. All four modes exited 0 (see matching `.json` metadata).

| Metric | Baseline | Posted | Voided |
|---|---:|---:|---:|
| Income | 229000 | 229321 | 229000 |
| Net profit | 40986 | 41307 | 40986 |
| Assets | 172986 | 173307 | 172986 |
| Cash-ledger closing | −1656200 | −1655879 | −1656200 |

Retained debit line `575435be-bd55-4c84-9191-44a8bc3914ef` and credit line
`4fa1949e-e316-4079-b6e3-e451b1fd2096` are unchanged throughout. Trial balance
totals match and the balance-sheet identity holds. Runtime fixture records
`cleaned:true`; voided journal history remains intact.

## Limits

Keyboard attempts to activate Void produced no request. Subsequent activation of
the existing DOM button succeeded; this alone does not establish a keyboard
product defect. Earlier pointer `UnknownVizError` and the fixed narrow viewport
remain host limitations. This workflow does not prove desktop layout or pointer
hit-testing. The user has been asked to pause manual dialog confirmations so
subsequent dialogs can be inspected and controlled consistently.
