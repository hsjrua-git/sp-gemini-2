# GitHub publication receipt — 2026-10-30

Repository: **https://github.com/hsjrua-git/sp-gemini-2**

- Created successfully at 11:22 UTC with **PRIVATE** visibility.
- Published local `audit-fixes` to remote **`main`** using remote `sp-gemini-2`.
- Initial published commit: **`4c51ae91c52967ceebc75ce397273b42388723e9`**.
- `git ls-remote` returned that exact SHA for `refs/heads/main`.
- GitHub confirmed `main` as the default branch, private visibility and a
  nonempty repository.
- The initial push includes the verified implementation, release report and
  preservation reconciliation. This receipt and its command records are added
  in the following documentation-only commit.

## Retained command evidence

Each basename below has a `.json` command/exit-status receipt and `.txt` output.
All four commands exited **0**.

| Basename | Recorded operation |
| --- | --- |
| `github-create` | Create the private repository |
| `github-initial-push` | Push the verified history as `main` |
| `github-repository` | Read GitHub visibility/default-branch metadata |
| `github-initial-head` | Read the exact published branch SHA |

The pre-publication configured-secret scan checked the staged tree and HEAD
history (38 revision/index targets): zero matches and no tracked
`server/.env`/`agent/.env` history. The database backup remains local and ignored.
The preservation reconciliation passed for 629 inventory files and 295 protected
evidence files; all six supplied handoff/schema files and 26 workflow captures
retain their recorded hashes. All six new release captures also matched their
recorded byte lengths and SHA-256 hashes.

See the [release report](../../docs/release-2026-10-30-sp-gemini-2.md) for the
verified fixes, test counts and outstanding policy/device/performance limits.
