# Dependency audit — Electron 44 isolated build

Date: 2026-10-28. Branch: `security/electron44-deps-refresh`
(base `experiment/electron44-isolated` @ `bd15bc8` + lockfile refresh `ea86131` from PR #3).

## What changed

Only `yarn.lock`, keeping the semver ranges already declared:

| Package | Before | After |
|---|---:|---:|
| seroval (SolidJS runtime) | 1.2.1 | 1.6.11 |
| proxy-addr | 2.0.7 | 2.0.8 |
| form-data | 4.0.0 | 4.0.6 |
| tar 7.x | 7.4.3 | 7.5.22 |
| tar 6.x (dedup) | 6.2.0 + 6.2.1 | 6.2.1 |

## How the audit was run

```
yarn npm audit --all --recursive --environment production --json
yarn npm audit --all --recursive --environment development --json
yarn npm audit --all --recursive --environment all --json
```

| Scope | critical | high | moderate | low | total |
|---|---:|---:|---:|---:|---:|
| production (`dependencies`) | 0 | 32 | 19 | 2 | 53 |
| development (`devDependencies`) | 1 | 83 | 64 | 15 | 163 |
| all (deduplicated) | 1 | 87 | 65 | 15 | 168 |
| all, after Electron 44.10.0 | 1 | 86 | 65 | 15 | 167 |

## Why the production/development split is misleading here

`package.json` sorting does not match what ships in the installer:

- **`electron` is a devDependency but it is the runtime.** Yarn files its
  advisories under "development".
- **The app code is bundled by Vite** (Electron Forge Vite plugin). In the
  local build, `.vite/build/main.js` only `require`s Node built-ins and
  `electron`; everything else (electron-store/conf/ajv, auto-launch,
  electron-dl, electron-context-menu, zod, nanoid, solid-js/seroval) is
  inlined in the bundles. Build-only packages that sit under `dependencies`
  (e.g. `@kobalte/tailwindcss` → `tailwindcss` → `postcss`, `micromatch`,
  `glob`, `brace-expansion`) inflate the "production" count without running
  in the app.

The triage below therefore classifies by **what code runs in the packaged app**.

## Packaging finding

Before `build/asar-packaging`, `resources/app` in the packaged build was
**not an asar** and contained the whole repository (sources, `.github`,
`tests`, configs) plus an 83-entry `node_modules` including dev tooling
(`@babel`, `@eslint`, `@electron-forge`, `@xmldom`, …) that the bundles never
load. That branch now ships only `.vite/` and `package.json` in `app.asar`
(1.8 MB instead of 24 MB of loose files).

## Triage

### Shipped runtime — act on these

| Advisory | Package | Reachability | Action |
|---|---|---|---|
| Mitigation for compromised eMudhra intermediate certificates (high) | `electron@44.9.0`, fixed in 44.9.1 | Runtime TLS trust store used for every WhatsApp Web connection | **Fixed: Electron updated to 44.10.0** (`c550dcf`); no Electron advisory left in the re-run audit |
| Several DoS / integer issues (high) | `nanoid@5.1.5` (direct) | Only called with constant sizes to create tab IDs; not fed remote input | **Fixed: lockfile bump to 5.1.16** (see the re-run below) |
| Memory exhaustion on oversized constrained collections (high) | `zod@3.24.2` (direct) | Validates settings IPC from our own renderer; fix requires zod 4 (major) | **Fixed: zod 4.6.6** (Dependabot #21; schema covered by `tests/settings.test.mjs`) |
| ReDoS with `$data` option (moderate) | `ajv@8.12.0` via `electron-store` → `conf` | Schema is ours and does not use `$data` | Not reachable |

### Build / packaging only — not shipped in the EXE

`tar@6.2.1` (the one **critical**, DoS on decompression, via `app-builder-lib`),
`@xmldom/xmldom`, `extract-zip`, `js-yaml`, `minimatch`, `glob`,
`brace-expansion`, `postcss`, `rollup`, `vite`, `express`/`body-parser`/
`path-to-regexp`/`ws` (Forge dev server), `lodash` (Forge), `tmp`,
`cross-spawn`, `flatted`, `browserslist`, `builder-util-runtime@9.3.1`
(the copy under `app-builder-lib`; `electron-updater`, which ships in the app
since 5.8.1-plus.3, uses `builder-util-runtime@9.7.0`, already patched).

These only run on the developer/CI machine against inputs we control
(our own sources, Electron/NSIS downloads over HTTPS). They matter for
supply-chain hygiene, not for the installed app. Fixing most of them needs
major upgrades of Forge / Vite / electron-builder and is out of scope for a
lockfile-only change.

## Re-run 2026-10-28 (hardening: fuses, CSP, audit)

New advisories appeared after the first audit. Re-run with
`yarn npm audit --all --recursive --environment production --severity high`,
then each package's code was looked for in the built bundles
(`.vite/build/*.js`, `.vite/renderer/main_window/assets/*.js`).

| Package | Ships in the app? | Action |
|---|---|---|
| `nanoid` 5.1.5 / 3.3.6 | 5.x yes (tab and theme IDs, default generator only); 3.x via postcss, build only | Lockfile bump within the declared ranges: 5.1.16 and 3.3.20 |
| `zod` 3.24.2 (GHSA-mrhx-c7xc-m3w5) | Yes | Not reachable: one `safeParse` per settings key, no array schemas, input only from the app's own window (sender-checked). **Later fixed: zod 4.6.6**, no longer ignored |
| `ajv` 8.12.0 (moderate) | Yes, via electron-store | `$data` not used; not reachable |
| `braces`, `minimatch`, `picomatch`, `postcss` | No (tailwindcss / postcss / sucrase / chokidar, CSS build) | Ignored |
| `brace-expansion` 1.1.11 / 2.0.1 | No (CSS build; 2.x via app-builder-lib → minimatch, installer build) | **Later fixed: 1.1.21** (Dependabot #26) **and 2.1.7** (lockfile bump), no longer ignored |
| `source-map-js` 1.0.2 | No (postcss) | **Later fixed: 1.2.2** (Dependabot #22), no longer ignored |
| `cross-spawn`, `glob` CLI, `ip-address` | No (node-gyp / cacache / make-fetch-happen) | Ignored |
| `http-cache-semantics` 4.1.1 (GHSA-ch52-4w7c-c8xp) | No (make-fetch-happen) | **Advisory withdrawn** by GitHub on 2026-10-28 (not a fix; version unchanged), no longer ignored |
| `electron` | Runtime | No advisories |

### Ignored advisories

`.yarnrc.yml` lists the advisory IDs above under `npmAuditIgnoreAdvisories`,
so that `yarn npm audit` and the weekly **Security audit** workflow only fail
on advisories nobody has looked at yet. Ignoring is per advisory ID, not per
package: a new advisory against the same package still fails the check.
Remove an ID when its package is upgraded past the fix or the advisory is
withdrawn, after re-running the audit with the ignore list off
(`YARN_NPM_AUDIT_IGNORE_ADVISORIES=0`) to confirm it is no longer reported.

The workflow also fails on **any** advisory against `electron`
(`.github/scripts/check-electron-advisories.mjs`), whatever its severity.
Newer Electron releases, which carry Chromium security fixes without an npm
advisory, are checked weekly by a separate workflow (`docs/RELEASING.md`,
"Electron updates").

## Not claimed

- This does not prove the shipped app is free of vulnerabilities; it only
  re-checks the dependency graph against the npm advisory database on the
  date above.
- Reachability notes are based on reading how each package is used, not on
  dynamic testing.
