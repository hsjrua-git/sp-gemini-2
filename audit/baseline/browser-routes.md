# Browser route observations — 2026-10-29

API/SPA: `http://127.0.0.1:3300`; isolated seeded database; sample administrator.
Browser tab: `tab_4a556168-a0fd-4e42-b0b2-bc6851fa3cb6`.
Measured viewport width **454 px**, Persian/RTL. These are route-render checks,
not proof of successful form submissions or desktop/Android coverage.

The initial login used the actual login form. The following routes were then
navigated through the browser; each had an h1, no detected error-boundary text,
zero document horizontal overflow, and no captured error-level console messages:

```
/dashboard
/students
/students/74e7d5d8-c540-4387-9043-06b368426f0e
/students/import
/evaluate
/evaluate/import
/parameters
/results
/export
/users
/roles
/groups
/fields
/teachers
/schedule
/sessions
/cafe
/cafe/products
/cafe/purchases
/cafe/inventory
/cafe/reports
/accounting/journal
/accounting/accounts
/accounting/periods
/accounting/reports
/agent
/agent/transcripts
/preferences
/change-password
/audit
```

Earlier route observations were recovered from the saved tool transcript;
the last five routes were checked after resumption. Boundary detection searched
`Something went wrong` / `مشکلی پیش آمد`; DOM inspection used h1, main text,
and `scrollWidth - clientWidth`. It does not detect every possible page error.

Additional observed navigation:

| Requested | Resolved | h1 | Overflow | Console errors |
|---|---|---|---:|---:|
| `/` | `/dashboard` | داشبورد | 0 | 0 |
| `/audit-route-does-not-exist` | same | صفحه پیدا نشد | 0 | 0 |

The landing-route observation still showed a dashboard loader after one second;
only the redirect/shell is established by that observation. Dashboard content
was separately observed during the original route sweep. No screenshots,
desktop-width sweep, keyboard/focus audit, or device run has been saved yet.
