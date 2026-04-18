# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## v2.0.0 - 2026-04-18

Application Insights `v3` support added alongside continued `v2` support. Peer dep range widened to `applicationinsights >=2 <4`. Most v3 differences are masked by the library, but a handful of consumer-visible behaviours change with the SDK version — see [README › Application Insights v2 vs v3](./README.md#application-insights-v2-vs-v3) for the full matrix.

### Potentially breaking

- **`peerDependencies.applicationinsights`** widened from `2.x` to `>=2 <4`. v2 still works as before; v3 is the classic-API shim over `@azure/monitor-opentelemetry-exporter`.
- **`TelemetryTransformation#convertLevel` return type is now version-dependent.** v2 returns numeric `Contracts.SeverityLevel` (0–4, unchanged); v3 returns string `KnownSeverityLevel` ('Verbose'…'Critical'). v3's `trackTrace` treats numeric `0` as falsy, so the library has to feed it the string enum — there is no single value that satisfies both wire formats. The chunk's `severity` field on the [Telemetrish object](./README.md#telemetrish-object) reflects whichever the loaded SDK exposes. Custom `track` functions that compare `chunk.severity` against a hardcoded numeric constant must be updated to use the loaded SDK's enum.
- **Wire-level `severityLevel` on captured AI envelopes is numeric under v2 and string under v3.** Tests/assertions that hardcode a numeric `severityLevel` need a per-version map (see `test/src/log-transport-test.js`'s `wireSeverity`).
- **`tagOverrides` is silently ignored on v3.** The v3 shim populates the wire envelope `tags` map from OpenTelemetry resource attributes only. v2 behaviour is unchanged. Migrate v3 callers to OTel resource attributes (`service.name`, `service.instance.id`, etc.) for role/instance/user metadata.
- **A bare instrumentation key as `connectionString` no longer works on v3.** v3's `TelemetryClient` requires the full `InstrumentationKey=…;IngestionEndpoint=…` string. v2 still accepts a bare UUID.
- **`config.maxBatchSize` is silently dropped on v3** (the shim logs `The maxBatchSize configuration option is not supported by the shim`). v3 batches via OTel's `BatchLogRecordProcessor` (~5 s default `scheduledDelayMillis`). Call `await client.flush()` from a custom `track` function if you need eager export.
- **`config.disableStatsbeat: true` is a no-op on v3.** v2 still calls `client.getStatsbeat().enable(false)`; v3's `getStatsbeat()` returns `null` and the library deliberately does **not** mutate `process.env.APPLICATION_INSIGHTS_NO_STATSBEAT` on your behalf. Set the env var yourself before any `applicationinsights` import — `example/logger.js` shows the `pino.transport` worker-env recipe and `test/helpers/setup.js` shows the main-process setup.
- **Exception envelopes differ between v2 and v3.** v3 omits `hasFullStack` and emits a different `parsedStack` frame shape. Any test asserting against captured `exceptions[i]` fields needs to gate v2-only fields behind a version check.
- **Wire-envelope `time` is computed differently on v3.** v2 propagates the `time: <Date>` you pass to `trackTrace`/`trackException` straight to the wire `time` field. v3's OTel exporter derives the wire timestamp from `process.hrtime` instead of `Date.now()`, so `chronokinesis.freeze` can't override it. Tests that pin `time` via clock-mocking work on v2 only.
- **`FakeApplicationInsights.expect(count)` no longer registers a `.times(count)` nock interceptor that yields after `count` matches.** A persistent fallback now replies `200 { itemsReceived, itemsAccepted, errors: [] }` to any trailing requests. Tests that relied on registering an external `nock(...).post(...).reply(...)` to "catch overflow" after `expect(count)` resolved will not see those follow-up requests — drop the external interceptor; the fallback handles them.
- **`FakeApplicationInsights.reset()` now removes only the interceptors this instance registered**, instead of calling `nock.cleanAll()`. Any user-registered nock state is left untouched. The dispatcher is re-installed lazily on the next `expect…()` call rather than eagerly in the constructor, so an idle FAI instance leaves no nock state behind. If your test relied on `fakeAI.reset()` to clean every nock interceptor in the process, call `nock.cleanAll()` yourself.

### Fixes

- v3 batches multiple telemetry items (e.g. trace + exception from a single `logger.error`) into one HTTP POST. The previous one-nock-interceptor-per-`expect` design only matched the first item and left subsequent expectations hanging. Replaced with a single persistent dispatcher that resolves all matching pending expectations from each request body.
- `FakeApplicationInsights` no longer reads `client.config.endpointUrl` (gone in v3); the ingestion endpoint is parsed from the connection string directly via the new `src/connection-string.js` helper.
- v3's wire format is `application/json` (not gzipped NDJSON); the FAI body decoder (`src/wire-format.js#extractTelemetryItems`) handles both encodings transparently.

## v1.1.3 - 2025-11-14

- npm package provenance release

## v1.1.2 - 2024-11-17

- document `tagOverrides`

## v1.1.1 - 2024-11-16

- pass `tagOverrides` to TelemetryClient

## v1.1.0 - 2024-11-16

- forward `tagOverrides` to trace logging
- add example app with tagOverrides logging

## v1.0.1 - 2024-10-27

- peer bump `pino-abstract-transport@2` since it dropped one dependency, but for some reason it keeps all files in the entire github project, as do split2, and pino, all adding up to lots of unneccessary files being zipped and deployed to azure, deploy time to azure is correlated to number of files deployed, not to mention [applicationinsights@3](https://bundlephobia.com/package/applicationinsights), what happened between 2 and 3? END RANT
- `dts-buddy` touched typings, adding an empty export object at the end of namespace, might be important

## v1.0.0 - 2024-05-20

In production, and has been for a while.

- use prettier for formatting rules
- use [texample](https://www.npmjs.com/package/texample) to run through README examples, unsuccessfully I might add. No syntax errors but not running through

## v0.1.2 - 2023-11-16

- fix naive implementation of fake expect function, not sure what it did before
- redecorate some typing

## v0.1.1 - 2023-11-13

- make track function optional in typescript as well

## v0.1.0 - 2023-11-13

First version worth mentioning.

- make track function optional in typescript as well
- track function defaults to tracking trace and exception
