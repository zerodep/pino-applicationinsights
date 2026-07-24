# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — runs the full pipeline: `npm run build` (pretest) → mocha against `test/src/**/*.js` and `test/commonjs/**/*.cjs` → `npm run test:ts` → `npm run lint` (posttest). **Lint must always run after tests** — never skip it, never reorder it. Don't paper over an SDK warning with an env var; fix the underlying nock setup.
- `npm run test:ts` — runs the TypeScript consumer test in `test/typescript/log-transport-test.ts` via `ts-node/esm`. Has its own `.mocharc.json`.
- `npm run lint` — `eslint . --cache && prettier . --check --cache`.
- `npm run build` — Rollup bundles `src/index.js` → `lib/index.cjs` and `src/fake-applicationinsights.js` → `lib/fake-applicationinsights.cjs`, then `dts-buddy` regenerates `types/index.d.ts`. Required before tests because the CommonJS test (`test/commonjs/log-transport-test.cjs`) imports the built `lib/`.
- `npm run cov:html` / `npm run test:lcov` — coverage via c8 over `src`. The lcov output is uploaded to Coveralls in CI; see **Coverage** below.
- Run a single test: `npx mocha test/src/compose-test.js` (or `--grep "pattern"`). For TS: `npx mocha --config test/typescript/.mocharc.json --grep "pattern"`.
- Node `>=16` required; `.nvmrc` pins Node 20. Mocha is launched with `--experimental-test-module-mocks` (set in `.mocharc.json` `node-option`) so tests can call `mock.module(...)` from `node:test`.

## Coverage

The Coveralls badge in `README.md` is a project USP and ships at **100% statements / 100% branches / 100% functions / 100% lines**. Hold that bar:

- After any source change, run `npx c8 -n src -r text mocha` and confirm every file still reports 100% across the table. If a new branch isn't exercised, **add a test rather than ship the branch uncovered** — even for "shouldn't happen" defensive guards. See `test/src/fake-applicationinsights-test.js#constructor handles a TelemetryClient that lacks getStatsbeat` and `…dispatcher matcher returns false for an empty body…` for examples of how to drive unreachable-in-practice paths (shadow prototype methods, `fetch` an empty body directly).
- Coverage regressions are caught by Coveralls' own PR check after the lcov upload — do **not** add a client-side `c8 --check-coverage` flag. The user has explicitly declined that approach.

## Architecture

The package ships two independent entry points that share the same `applicationinsights` peer dep but are otherwise decoupled:

1. **`src/index.js`** — the pino transport. `compose(opts, Transformation?)` returns a stream built with `pino-abstract-transport` that wires:

   `pino source → TelemetryTransformation (objectMode Transform) → destination Writable`

   The destination is either (a) a `Writable` constructed around a `TelemetryClient` whose `track` callback is bound to the client (default: `trackTraceAndException`), or (b) the caller's own `opts.destination` stream (in which case `connectionString`/`track`/`config` are ignored — useful for tests and for piping into the FakeApplicationInsights client). `TelemetryTransformation.convertToTelemetry` parses the pino JSON line, maps pino numeric levels (30/40/50/60) to the SDK's severity enum (see `SeverityLevel` selection in **v2 / v3 dual support** below), strips `ignoreKeys` (default `hostname, pid, level, time, msg`) plus `tagOverrides` from `properties`, and wraps any `err` field in the local `Exception` class. Subclassing `TelemetryTransformation` and passing it as the second arg to `compose` is the supported customization path.

2. **`src/fake-applicationinsights.js`** — `FakeApplicationInsights(connectionString)` is a test helper that uses `nock` to intercept POSTs to the AI ingestion endpoint and resolve a `CollectData` per matched telemetry type. `expectTelemetryType(type)` queues a single-envelope expectation; `expect(count)` queues a count-based collector. Internally a single persistent nock interceptor (the **dispatcher**) decodes each request body via the exported `extractTelemetryItems` helper and resolves all matching pending expectations from that one POST — required because the v3 SDK batches multiple telemetry items (e.g. trace + exception from a single `logger.error`) into one HTTP request, and the previous one-interceptor-per-`expect` design only matched the first item. A persistent **fallback** interceptor (registered alongside the dispatcher) replies `200` with `{ itemsReceived, itemsAccepted, errors: [] }` so trailing telemetry sent after all expectations are satisfied still gets a valid Breeze response — without it the SDK logs `Ingestion endpoint could not be reached`. The dispatcher + fallback are installed **lazily** on the first `expect…()` call (not in the constructor) so an idle FAI leaves no nock state behind, and `reset()` removes only the interceptors this instance registered (never `nock.cleanAll()`) so it can't trample on user-registered nock state. Each FAI tracks its own interceptor refs and uses `nock.removeInterceptor(ref)` for targeted cleanup. `nock` is an `optionalDependencies`, only loaded by this entry point.

### v2 / v3 dual support

The `applicationinsights` peer dep is `>=2 <4`. The library targets the v2 SDK _and_ the v3 classic-API "shim" (`applicationinsights@3` re-implemented over `@azure/monitor-opentelemetry-exporter`). The differences are confined to four exported helpers in the two entry points:

- **`src/fake-applicationinsights.js#parseConnectionString`** — own parser for `InstrumentationKey=…;IngestionEndpoint=…` strings, needed because v3 dropped `client.config.endpointUrl` from the public surface.
- **`src/index.js#applyClientConfig`** — disables statsbeat by calling `client.getStatsbeat().enable(false)` when a real statsbeat instance is returned (v2). v3's `getStatsbeat()` returns `null`, so the call is a no-op there; disabling statsbeat on v3 is a caller responsibility, set via the `APPLICATION_INSIGHTS_NO_STATSBEAT=disable` env var **before** any `applicationinsights` import (see `example/logger.js`'s `worker.env` recipe and `test/helpers/setup.js` for examples). The library deliberately never mutates `process.env`.
- **`src/fake-applicationinsights.js#extractTelemetryItems`** — `FakeApplicationInsights` accepts both wire encodings: v2's gzipped NDJSON (delivered as a hex string by nock) and v3's `application/json` array (parsed by nock into a JS value). Both formats hit the same `/v2.1/track` path, which is hardcoded as `INGESTION_PATHNAME`.
- **`src/index.js#SeverityLevel`** — picks the version-appropriate enum at module load: `applicationinsights.Contracts?.SeverityLevel` (v2 numeric `Verbose=0…Critical=4`) → `applicationinsights.KnownSeverityLevel` (v3 string `'Verbose'…'Critical'`) → numeric fallback for hand-rolled mocks. v3's `trackTrace` treats numeric `0` as falsy and silently defaults to `Information`, so v3 has to be fed the string enum. The wire-level `severityLevel` field ends up numeric for v2 and string for v3 — tests use a per-version `wireSeverity` map (see `log-transport-test.js`).

### Cross-version test layers

CI installs both versions side-by-side: `applicationinsights` at v2.x and an aliased `applicationinsights-v3` (`npm:applicationinsights@^3`). The dual-version proof runs entirely under mocha (`--experimental-test-module-mocks` in `.mocharc.json` `node-option` enables `mock.module()` from `node:test`).

The shared loop pattern in `test/src/module-mock-test.js`, `log-transport-test.js`, `compose-test.js`, and `fake-applicationinsights-test.js`:

```js
['applicationinsights', 'applicationinsights-v3'].forEach((version) => {
  describe(`… ${version}`, () => {
    before(async () => {
      const ai = await import(version);
      mockApplicationinsights(ai); // test/helpers/mock-module.js — see Module-mock helper below
      // Cache-bust BOTH compose and FakeApplicationInsights so each iteration
      // re-evaluates them under the active mock — without ?v=… the second
      // iteration would still hold the first version's TelemetryClient ref.
      const bust = `?v=${version}-${++cacheBust}`;
      compose = (await import(`../../src/index.js${bust}`)).default;
      const { FakeApplicationInsights } = await import(`../../src/fake-applicationinsights.js${bust}`);
      // Auto-flush patch: v3's BatchLogRecordProcessor delays exports ~5s and
      // explicitly drops maxBatchSize, so wrap each track method to flush after
      // the original. v2 flushes are cheap when the channel is idle. The flushes
      // are *serialized* through `flushState.chain` (a const holder so ESLint's
      // no-loop-func is satisfied) — see the flush-serialization note below.
      const flushState = { chain: Promise.resolve() };
      for (const m of ['trackTrace', 'trackException', 'trackEvent', 'trackMetric']) {
        const original = TelemetryClient.prototype[m];
        if (typeof original !== 'function') continue;
        mock.method(TelemetryClient.prototype, m, function (...args) {
          const r = original.apply(this, args);
          if (typeof this.flush === 'function') flushState.chain = flushState.chain.then(() => this.flush()).catch(() => {});
          return r;
        });
      }
    });
    after(() => mock.restoreAll());
  });
});
```

**Module-mock helper (`test/helpers/mock-module.js`, required for Node >= 24).** Every `mock.module('applicationinsights', …)` call goes through `mockApplicationinsights(ai)` (and `mockModule(url, …)` for the example-logger ESM mock) rather than calling `mock.module` inline. Node 24 deprecated `namedExports`/`defaultExport` in favour of a single `exports` object **and** rewrote the CJS mock loader (`cjsMockModuleLoad`) to overlay the named exports onto `exports.default` with `Object.defineProperty`. Passing the live ESM namespace `ai` makes `exports.default` point at the real `applicationinsights` module — whose exports are non-configurable getters (compiled TypeScript) — so the overlay throws `TypeError: Cannot redefine property: __esModule` / `Configuration` on Node >= 24 (CI's `latest`). The helper sidesteps it by handing over a fresh, configurable, `default`-free copy of the named exports (so the loader builds a brand-new exports object), and picks `exports` on Node >= 24 vs the older `namedExports`/`defaultExport` on Node 20/22 (the `exports` option is silently ignored there). Keep all module mocking funnelled through this helper; don't reintroduce inline `mock.module('applicationinsights', { namedExports: ai })`.

**Flush serialization (`@opentelemetry/sdk-logs >= 0.215`, pulled in by `applicationinsights@3.15`).** The auto-flush patch must chain its flushes, not fire them concurrently. The new OTel `BatchLogRecordProcessorBase._flushAll()` guards against concurrent flushes: a `forceFlush()` that overlaps the previous flush's still-settling async tail (`_flushing` is only reset _after_ `exportCompleted`) returns immediately **without** exporting the just-queued record, which then waits for the ~5s `scheduledDelayMillis` tick — blowing mocha's 2s timeout. Serializing via `flushState.chain.then(() => this.flush())` makes each flush wait for the prior one to fully settle (the SDK's `flush()` resolves only after `_flushAll` completes), so nothing races the guard. This is upstream behaviour ([opentelemetry-js#6356](https://github.com/open-telemetry/opentelemetry-js/pull/6356)), surfaced neither in the `applicationinsights` changelog nor as a flagged breaking change; consumer-facing guidance lives in README → **Flush timing (v3)**. Reliable flushing also means **un-awaited telemetry now actually gets delivered** — a test that logs without `await`-ing its expectation can leak that envelope into a later shared `fakeAI.expect(n)` count collector; drain every log you emit (see `compose-test.js#no TelemetryClient config is ok`).

- v3-contract divergences kept inside the loop with `if (version === 'applicationinsights')` skips: `tagOverrides` (v3 ignores them — wire `tags` come from OTel resource attributes), `hasFullStack`/v2-shaped `parsedStack`, bare-instrumentation-key initialisation (v3 requires a full connection string).
- `test/src/applicationinsights-v3-test.js` — extra end-to-end coverage of the real v3 SDK driven directly (no `mock.module`), with explicit `await v3Client.flush()`.

Tests must remain network-free — nock + mocked clients only.

## Build & types

- The package is dual ESM/CJS. `package.json` `exports` maps `import` → `src/*.js` and `require` → `lib/*.cjs`. **Never hand-edit `lib/`** — it is generated by Rollup; edit `src/` and rebuild.
- Types are JSDoc-driven: `src/*.js` carries `@type`/`@param` annotations, `tsconfig.json` runs with `allowJs` + `checkJs` + `strict`, and `dts-buddy` emits `types/index.d.ts` from those annotations during `npm run build`. Hand-written interfaces live in `types/interfaces.d.ts` and are referenced from JSDoc via `import('../types/interfaces.js')`.
- The TS consumer test in `test/typescript/` exists specifically to verify the published `.d.ts` surface compiles against real consumer code; treat a failure there as a public API regression.

## Conventions

- ESLint `eslint.config.js` flat config; key rules: `no-console: 2`, `eqeqeq`, `prefer-const`, `require-await`, semi always. Prettier: 140 print width, single quotes, 2-space tabs.
- `.gitignore` excludes `CLAUDE.md`, `.claude`, `.agents`, `.pi` — AI-assistant artifacts stay local.
- `applicationinsights` peer dep is `>=2 <4`. v2 is the primary install; v3 is exercised through the aliased `applicationinsights-v3` devDep. The two surfaces diverge only in the spots called out under **v2 / v3 dual support** above — keep version-specific knowledge in the helpers listed under **v2 / v3 dual support** (`applyClientConfig`, `SeverityLevel`, `parseConnectionString`, `extractTelemetryItems`) rather than scattering version checks through callers.
