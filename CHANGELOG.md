# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## v2.0.0 - 2026-04-23

Add `applicationinsights@3` support alongside `v2`. See [README › Application Insights v2 vs v3](./README.md#application-insights-v2-vs-v3) for the full behavioural matrix.

### Features

- New `tracing` field on log records (`{ traceId, spanId, traceFlags?, traceState? }`) forwarded by the default `trackTraceAndException` — as `ai.operation.id` / `ai.operation.parentId` on v2, and via the active OpenTelemetry context on v3. See [README › Distributed tracing](./README.md#distributed-tracing).
- Exported `applyTracing(tracing, fn)` helper for custom `track` callbacks.

### Breaking

- Drop Node 18 support.
- `chunk.severity` and wire `severityLevel` are numeric on v2 but string on v3 (v3 dropped `Contracts.SeverityLevel`). Custom `track` functions and test assertions that hardcode numeric severity need a per-version map.
- `tagOverrides` is silently ignored on v3 — the wire `tags` come from OpenTelemetry resource attributes. Use the new `tracing` field for cross-version correlation.
- v3 requires a full `InstrumentationKey=…;IngestionEndpoint=…` connection string; bare instrumentation keys no longer work.
- `config.maxBatchSize` and `config.disableStatsbeat` are no-ops on v3. v3 batches via OTel's `BatchLogRecordProcessor`; call `await client.flush()` for eager export. Disable statsbeat by setting `APPLICATION_INSIGHTS_NO_STATSBEAT=disable` before any `applicationinsights` import (see `example/logger.js`).
- Exception envelopes differ on v3 (no `hasFullStack`, different `parsedStack` shape). Gate v2-only fields behind a version check.
- Wire-envelope `time` on v3 comes from `process.hrtime`, so clock-mocking (e.g. `chronokinesis.freeze`) only works on v2.
- `FakeApplicationInsights.expect(count)` no longer registers a single `.times(count)` interceptor; a persistent fallback replies `200` to trailing requests. Drop any external `nock(...).post(...).reply(...)` overflow interceptors.
- `FakeApplicationInsights.reset()` now removes only its own interceptors (not `nock.cleanAll()`); the dispatcher installs lazily. Call `nock.cleanAll()` yourself if you relied on the old behaviour.

### Fixes

- v3 batches multiple telemetry items per POST — replaced the one-interceptor-per-`expect` design with a persistent dispatcher that resolves all matching pending expectations from each request body.
- Parse the ingestion endpoint from the connection string (`src/connection-string.js`) instead of reading `client.config.endpointUrl` (gone in v3).
- Decode both v2 (gzipped NDJSON) and v3 (JSON array) wire formats transparently in `src/wire-format.js`.

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
