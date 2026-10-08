# Contributing

- Bugs and ideas: open an issue. Questions: Discussions.
- Pull requests: one change per PR, plain JS/CSS, no build step, no new dependencies.
- The extension stays read-only. PRs that create or change anything in Facebook are declined.
- Every UI string goes through `fb-helper/js/i18n.js` in both `ru` and `en`. A feature module can keep its own in `fb-helper/js/strings/<feature>.js` and register them with `addStrings`; the key-coverage test loads those files.
- Keep the version at what `fb-helper/manifest.json` says; maintainers bump it.
- Run `node --test test/*.test.mjs` before a PR; UI or Graph-flow changes also get a case in a `test/flows/*.mjs` file (the shared harness is `test/harness.mjs`, run with `node test/e2e.mjs <flow>` after `npm ci`; see README → Tests). A flow takes the words it checks from the extension (`tr("key")`), waits for a state or a request, never for a fixed time, and ends its browser with `done(b)`; the exact English wording of each tab is pinned once, in `test/flows/golden.mjs`.
