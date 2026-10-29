# Dependency assessment — baseline a4d81f0

Evidence is the retained npm audit payload in `baseline/dependencies-client.txt`
and installed-tree output in `continuation-02/dependency-tree.txt`. This is a
version/reachability review, not an exploit test. No dependency was changed.

## Installed affected packages (A17)

| Package/path | Saved advisory and affected range | Application reachability |
|---|---|---|
| Vite 8.3.0; direct dev tool and Vitest dependency | GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm: editor argument/Windows command handling; >=8.3.0 <=8.3.2 | Relevant when the development server/editor integration is reachable and the advisory's editor/platform preconditions hold. Windows-specific cases are not reproduced on this Linux host. |
| Vite 8.3.0 | GHSA-9jrq-w75r-8gcw: cross-origin script execution through custom middleware; same range | Project config supplies React plugin and an API proxy, not a custom middleware implementation. A concrete applicable cross-origin attack path is not established. |
| Vite 8.3.0 | GHSA-rq7h-c2jc-7f22: non-Windows filesystem allow-boundary bypass; GHSA-vfpm-58rq-9qcg: four-byte file disclosure using `?vite-wasm-instance`; same range | Conditional dev-server exposure. Config does not disable filesystem restrictions or bind publicly; normal dev command is `vite`. Loopback is not a general proof of safety from every browser-origin attack. No arbitrary-file probe was run. |
| Vitest and @vitest/mocker 5.0.1 | GHSA-qxg6-89mg-rqv8 (>=5.0.0-beta.1 <5.0.3), GHSA-xp26-3454-mjgp (>=5.0.0-rc.2 <5.0.3) | Tests use jsdom/vmThreads, not configured browser mode. Browser/manual-mock registration exposure is not established in the current test command. Windows traversal is platform-specific. Vitest's entry is transitive from mocker, not a sixth independent flaw. |
| Vite → PostCSS 8.5.28 → source-map-js 1.2.1 | GHSA-68fv-2mgg-jv7q: indexed source-map section-offset event-loop DoS; >=1.0.0 <1.2.2 | Build/dev tooling can process source maps. No server endpoint accepts source maps from application users. Untrusted build inputs are the relevant boundary; no malformed-map exploit run. |
| eslint-plugin-react-hooks 7.1.1 → Zod 4.6.5 (also through zod-validation-error) | GHSA-mrhx-c7xc-m3w5: oversized constrained collection memory exhaustion; <4.6.6 | Lint/compiler validation dependency. No production application request-validation path through this Zod installation was found. No memory-exhaustion probe run. |

The saved payload labels Vite/source-map-js/Zod high and the two Vitest packages
moderate. These vendor scores are not evidence of a high-severity production
Student Panel exploit. The report assigns **MEDIUM / VERIFIED version match /
AUTO compatible patches** with exploitation explicitly unverified.

`npm ls --omit=dev vite vitest @vitest/mocker source-map-js zod` returned an empty
tree (exit 1 for no matches), retained in
`continuation-02/production-dependencies.{txt,json}`. The production server serves
the built SPA; it does not launch Vite or Vitest. This narrows reachability, but
is not a binary-bundle proof that no build-time effect is possible. Server and
agent audit payloads report zero known vulnerabilities at capture time; zero is
not a guarantee against unknown vulnerabilities.

## Remediation boundary

Use patched releases satisfying current major-version ranges; the saved advisory
boundaries are Vite 8.3.3, Vitest/mocker 5.0.3, source-map-js 1.2.2 and Zod 4.6.6.
Confirm candidate package metadata and the resolved tree during Stage 2, inspect
the exact lockfile changes and rerun npm audit plus required checks. Major
upgrades, dependency replacement or API redesign remain ASK. An audit database
changing later may produce additional advisories; preserve this baseline.
