# pino applicationinsights transport

[![Build](https://github.com/zerodep/pino-applicationinsights/actions/workflows/build.yaml/badge.svg)](https://github.com/zerodep/pino-applicationinsights/actions/workflows/build.yaml)[![Coverage Status](https://coveralls.io/repos/github/zerodep/pino-applicationinsights/badge.svg?branch=default)](https://coveralls.io/github/zerodep/pino-applicationinsights?branch=default)

Forward pino logger to Application Insights.

Works with both [`applicationinsights@2`](https://www.npmjs.com/package/applicationinsights/v/2.9.8) and [`applicationinsights@3`](https://www.npmjs.com/package/applicationinsights) (the v3 classic-API shim over `@azure/monitor-opentelemetry-exporter`). The peer dep range is `>=2 <4`. See [Application Insights v2 vs v3](#application-insights-v2-vs-v3) for behavioural differences and caveats.

Have a look in [Example app](/example) to get inspiration of how to use this lib.

Ships with [fake applicationinsights](#class-fakeapplicationinsightssetupstring) helper test class.

## Usage

```javascript
import { pino } from 'pino';
import compose from '@0dep/pino-applicationinsights';
import { TelemetryClient } from 'applicationinsights';

// `client.context.keys` works on both v2 and v3 — v2's `Contracts.ContextTagKeys`
// is gone in v3.
const tagKeys = new TelemetryClient(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING).context.keys;

const transport = compose({
  track(chunk) {
    const { time, severity, msg: message, properties, exception } = chunk;
    this.trackTrace({ time, severity, message, properties });
    if (exception) this.trackException({ time, exception, severity });
  },
  connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  config: { maxBatchSize: 1 },
});

const logger = pino(
  {
    level: 'trace',
    mixin(context) {
      return {
        tagOverrides: {
          [tagKeys.userId]: 'someUserIdPickedFromRequest',
          ...context.tagOverrides,
        },
      };
    },
  },
  transport,
);
```

> **Note:** `tagOverrides` is honoured by `applicationinsights@2` only. The v3 classic-API shim ignores it — see [Application Insights v2 vs v3](#application-insights-v2-vs-v3). For cross-version distributed-trace correlation, pass `tracing` from the mixin instead — see [Distributed tracing](#distributed-tracing).

or as multi transport:

```javascript
import { pino } from 'pino';

const transport = pino.transport({
  targets: [
    {
      level: 'info',
      target: '@0dep/pino-applicationinsights',
      worker: {
        env: { ...process.env, APPLICATION_INSIGHTS_NO_STATSBEAT: 'disable' },
      },
      options: {
        connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
        config: {
          disableStatsbeat: true,
        },
      },
    },
    {
      level: 'debug',
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: "yyyy-mm-dd'T'HH:MM:ss.l",
      },
    },
  ],
});

const logger = pino({ level: 'trace' }, transport);
```

## Distributed tracing

Correlate pino log records to an OpenTelemetry trace by returning a `tracing` object from the pino `mixin`. The default `trackTraceAndException` forwards it as Application Insights `ai.operation.id` / `ai.operation.parentId` on both SDK versions:

- **v2** — auto-merges `{ [client.context.keys.operationId]: traceId, [client.context.keys.operationParentId]: spanId }` into `tagOverrides`, which v2 copies to the wire envelope's `tags` map.
- **v3** — wraps the `trackTrace` / `trackException` calls in an OpenTelemetry context with the given span context so the `@azure/monitor-opentelemetry-exporter` stamps `operation_Id` / `operation_ParentId` on the wire envelope. This requires `@opentelemetry/api` to be resolvable at runtime — declared as peer dependency and satisfied transitively by both `applicationinsights@2` and `applicationinsights@3`.

```javascript
import { pino } from 'pino';
import { trace } from '@opentelemetry/api';
import compose from '@0dep/pino-applicationinsights';

const transport = compose({
  connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  config: { maxBatchSize: 1 },
});

const logger = pino(
  {
    level: 'trace',
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const { traceId, spanId, traceFlags, traceState } = span.spanContext();
      return { tracing: { traceId, spanId, traceFlags, traceState: traceState?.serialize() } };
    },
  },
  transport,
);
```

Fields on the `tracing` object:

- `traceId` — 32-hex-char W3C trace id, forwarded as `ai.operation.id`.
- `spanId` — 16-hex-char W3C span id, forwarded as `ai.operation.parentId`.
- `traceFlags` (optional, defaults to `1` / sampled) — honoured on v3 only.
- `traceState` (optional) — honoured on v3 only.

Precedence: user-supplied `tagOverrides` entries always win over the auto-derived correlation ids — set `tagOverrides[tagKeys.operationId]` explicitly to override.

### Worker-thread serialization

When used via `pino.transport({ targets: [...] })` the transport runs in a worker thread, so the `mixin` output is serialised across the worker boundary. `tracing` must be plain JSON — a live OpenTelemetry `Span` object cannot cross, which is why the mixin extracts `traceId` / `spanId` from `span.spanContext()` rather than passing the span itself.

### Custom `track` functions

Callers that pass a custom `track` callback to `compose` should wrap their `trackTrace` / `trackException` calls with the exported `applyTracing(chunk.tracing, () => { ... })` helper to preserve correlation across both SDK versions.

```javascript
import compose, { applyTracing } from '@0dep/pino-applicationinsights';

compose({
  track(chunk) {
    applyTracing(chunk.tracing, () => {
      const { time, severity, msg: message, properties } = chunk;
      this.trackTrace({ time, severity, message, properties });
    });
  },
  connectionString,
});
```

## API

### `compose(opts[, TelemetryTransformation]) => Stream`

Build transport stream function.

- `opts`:
  - `connectionString`: Application Insights connection string. A bare instrumentation key works on v2 only — v3 requires the full `InstrumentationKey=…;IngestionEndpoint=…` form.
  - `track(chunk)`: optional track function called with Telemetry client context, defaults to tracking trace and exception (`trackTraceAndException`)
    - `chunk`: [Telemetry:ish](#telemetrish-object) object
  - `config`: optional Application Insights Telemetry client config. `disableStatsbeat: true` only takes effect on v2; v3 needs the env-var recipe (see [statsbeat caveat](#statsbeat)).
  - `destination`: optional destination stream, makes compose ignore the above options
  - `ignoreKeys`: optional pino ignore keys, used to filter telemetry properties, defaults to `['hostname', 'pid', 'level', 'time', 'msg']`
- `TelemetryTransformation`: optional transformation stream extending [TelemetryTransformation](#class-telemetrytransformationoptions-config)

### `class TelemetryTransformation(options[, config])`

Telemetry transformation stream. Transforms pino log record to [Telemetry:ish](#telemetrish-object) object.

- `constructor(options[, config])`
  - `options`: transform stream options, `{ objectMode: true }` is always set
  - `config`: optional config object
    - `ignoreKeys`: optional pino ignore keys as string array
- `_transform(chunk, encoding, callback)`
- `convertToTelemetry(chunk)`: convert pino log record string or object to [telemetry:ish object](#telemetrish-object)
- `convertLevel(level)`: map pino log level number to the SDK's severity enum value. The exact value depends on the installed `applicationinsights` version — numeric `Contracts.SeverityLevel` (e.g. `1`) on v2, string `KnownSeverityLevel` (e.g. `'Information'`) on v3.
- `extractProperties(line, ignoreKeys)`: extract properties from log line
  - `line`: log line record object
  - `ignoreKeys`: configured ignore keys
- properties:
  - `ignoreKeys`: configured ignore keys, defaults to `['hostname', 'pid', 'level', 'time', 'msg']`

#### Telemetrish object

- `severity`: pino log level mapped to the loaded SDK's severity enum (numeric on v2, string on v3 — see [`convertLevel`](#class-telemetrytransformationoptions-config))
- `msg`: log message string
- `properties`: telemetry properties object, filtered through ignore keys
- `tagOverrides?`: object passed through from the pino log record (only honoured by v2's `trackTrace`/`trackException`; ignored by v3)
- `tracing?`: distributed-trace correlation ids (`{ traceId, spanId, traceFlags?, traceState? }`); the default track function forwards these to both v2 and v3 — see [Distributed tracing](#distributed-tracing)
- `exception?`: logged Error if any
- `[k: string]`: any other properties that facilitate telemetry logging

### `class FakeApplicationInsights(setupString)`

Intercept calls to application insights. Works against both v2 and v3 wire formats — the v2 SDK posts gzipped NDJSON, v3 posts an `application/json` array, and the helper decodes both.

- `constructor(setupString)`
  - `setupString`: connection string used to derive the ingestion endpoint. The constructor does **not** install any nock interceptors — they're set up lazily on the first `expect…()` call so an idle instance leaves no global state behind.
- `expectMessageData()`: Expect tracked message, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectEventData()`: Expect tracked event, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectExceptionData()`: Expect tracked exception, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectTelemetryType(telemetryType: string)`: Expect tracked telemetry type, returns [`Promise<FakeCollectData>`](#fakecollectdata)
  - `telemetryType`: Telemetry type string (e.g. `'MessageData'`, `'EventData'`, `'ExceptionData'`, `'MetricData'`)
- `expect(count = 1)`: Expect tracked telemetrys, returns promise with list of [`FakeCollectData`](#fakecollectdata). Resolves once at least `count` items have been accumulated across one or more requests; the resolved array may be longer than `count` when a single request batch tips the total over.
  - `count`: wait for at least this many tracked telemetrys before returning, default is 1
- `reset()`: Reset expected faked Application Insights calls. Removes only the interceptors this instance registered — never calls `nock.cleanAll()`, so any nock state your test suite has set up is left untouched. The dispatcher is re-installed lazily on the next `expect…()` call.
- properties:
  - `client`: a `TelemetryClient` instance (the SDK version that's installed)

#### Caveats

- The dispatcher resolves multiple pending expectations from a **single** request body, which is required because v3 batches multiple telemetry items (e.g. a `MessageData` and an `ExceptionData` produced by one `logger.error(err, msg)`) into one HTTP POST.
- A persistent fallback interceptor replies `200 { itemsReceived, itemsAccepted, errors: [] }` for any trailing telemetry sent after all expectations are satisfied — without it the SDK logs `Ingestion endpoint could not be reached` because nock raises `No match for request`.
- Tests that need v3 to flush eagerly (the OTel `BatchLogRecordProcessor` defaults to ~5s `scheduledDelayMillis` and v3 ignores `maxBatchSize`) should patch `TelemetryClient.prototype.{trackTrace,trackException,…}` to call `client.flush()` after each call — see `test/src/log-transport-test.js` for the pattern.

#### Example

```javascript
import { randomUUID } from 'node:crypto';
import 'mocha';
import { pino } from 'pino';

import compose from '@0dep/pino-applicationinsights';
import { FakeApplicationInsights } from '@0dep/pino-applicationinsights/fake-applicationinsights';

describe('test logger', () => {
  const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

  let fakeAI;
  before(() => {
    fakeAI = new FakeApplicationInsights(connectionString);
  });
  after(() => {
    fakeAI.reset();
  });

  it('log event track event', async () => {
    const transport = compose({
      track(chunk) {
        const { time, properties } = chunk;
        this.trackEvent({ name: 'my event', time, properties, measurements: { logins: 1 } });
      },
      connectionString,
      config: { maxBatchSize: 1, disableStatsbeat: true },
    });
    const logger = pino(transport);

    const expectMessage = fakeAI.expectEventData();

    logger.info({ bar: 'baz' }, 'foo');

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.deep.include({
      properties: { bar: 'baz' },
      measurements: { logins: 1 },
      name: 'my event',
    });

    transport.destroy();
  });
});
```

#### `FakeCollectData`

An object representing the request sent to application insights.

- `uri`: request uri
- `method`: request method
- `headers`: request headers object
- `body`:
  - `ver`: some version number, usually 1
  - `sampleRate`: sample rate number, usually 100
  - `tags`: object with tags. **v2 only** populates `tagOverrides` here; v3's wire `tags` come from OTel resource attributes. Tag names are available on `TelemetryClient.context.keys` for both versions, e.g.:
    - `ai.application.ver`: your package.json version
    - `ai.cloud.roleInstance`: hostname
    - `ai.device.osVersion` / `osPlatform` / `osArchitecture`
    - `ai.cloud.role`
    - `ai.internal.sdkVersion`: applicationinsights package version, e.g. `node:2.9.8` for v2, `node:3.x.y` for v3
    - `[tag name]`: any other tag found under `TelemetryClient.context.keys`
  - `data`:
    - `baseType`: telemetry type string
    - `baseData`:
      - `ver`: some version number, usually 2 for some reason
      - `properties`: telemetry properties object
      - `[message]`: logged message when tracking trace
      - `[severityLevel]`: applicationinsights severity level when tracking trace and exception. **Numeric (`0`–`4`) on v2; string (`'Verbose'`–`'Critical'`) on v3.**
      - `[exceptions]`: list of exceptions when tracking exception
        - `message`: error message
        - `typeName`: error class name
        - `hasFullStack`: **v2 only**; v3's exception envelope omits this flag
        - `parsedStack`: stack frames parsed as objects. Frame shape differs between v2 (`fileName`, `level`, `method`, `line`, `assembly`) and v3 (additional fields, no v2 `_baseSize`/`sizeInBytes` semantics)
      - `[x: string]`: any other telemetry property
  - `iKey`: applicationinsights instrumentation key
  - `name`: some ms name with iKey and the tracked type
  - `time`: log time

## Application Insights v2 vs v3

This library targets `applicationinsights >= 2 < 4`. The v3 SDK is a thin "classic-API" shim over the OpenTelemetry-based [`@azure/monitor-opentelemetry-exporter`](https://www.npmjs.com/package/@azure/monitor-opentelemetry-exporter); it intentionally preserves the `TelemetryClient` constructor and `trackTrace` / `trackException` / `trackEvent` / `trackMetric` methods but drops a number of v2 surface details. The library masks most of these for you, but a few are visible to consumers.

### Severity values

- v2's `Contracts.SeverityLevel` is a **numeric** enum: `Verbose=0, Information=1, Warning=2, Error=3, Critical=4`.
- v3 removed it and exposes `KnownSeverityLevel` with **string** values: `'Verbose', 'Information', 'Warning', 'Error', 'Critical'`.
- `compose()` picks the right one at module load (`Contracts.SeverityLevel ?? KnownSeverityLevel ?? numeric-fallback`). Custom `track` functions just pass `chunk.severity` through to the SDK.
- The wire `severityLevel` field on the AI envelope is therefore numeric under v2 and string under v3. Don't hardcode a numeric `0..4` comparison if you need to support both.

### `tagOverrides`

- v2 honours `tagOverrides` on `trackTrace` / `trackException` / etc. and copies them into the request envelope's `tags` map.
- The v3 shim **ignores `tagOverrides`** entirely. The wire `tags` map is built from OTel resource attributes (e.g. `service.name`, `service.instance.id`) and the `TelemetryClient` constructor's `useGlobalProviders` settings. To set role/instance/user info on v3, use the OTel resource API rather than `tagOverrides`.
- For distributed-trace correlation (`ai.operation.id` / `ai.operation.parentId`) that works on both versions, use the `tracing` field in the pino mixin — see [Distributed tracing](#distributed-tracing).

### `client.config.*`

- v2's `client.config` accepts dozens of knobs (`maxBatchSize`, `endpointUrl`, `samplingPercentage`, `disableAppInsights`, `enableAutoCollect*`, …) and applies them at runtime.
- v3 exposes a `client.config` object but most v2 knobs are no-ops or warn (`The maxBatchSize configuration option is not supported by the shim`). v3 batches via OTel's `BatchLogRecordProcessor` (default ~5s `scheduledDelayMillis`); call `await client.flush()` if you need eager export.
- The library's `applyClientConfig` merges your `config` into `client.config` regardless of version, but you should expect v3 to silently drop most of it.

<a id="statsbeat"></a>

### Disabling statsbeat

- On v2, `config.disableStatsbeat: true` calls `client.getStatsbeat().enable(false)`.
- On v3, `client.getStatsbeat()` returns `null` and `config.disableStatsbeat: true` is a no-op. The library does **not** mutate the `APPLICATION_INSIGHTS_NO_STATSBEAT` env var on your behalf — set it yourself before any `applicationinsights` import. Two recipes:
  1. **Main process** — set the env var before importing the SDK:

     ```javascript
     process.env.APPLICATION_INSIGHTS_NO_STATSBEAT = 'disable';
     const compose = (await import('@0dep/pino-applicationinsights')).default;
     ```

  2. **`pino.transport` worker** — pass it via the target's `worker.env` so the worker thread inherits the disabled flag without polluting the main process env. See [`example/logger.js`](./example/logger.js):

     ```javascript
     pino.transport({
       targets: [
         {
           target: '@0dep/pino-applicationinsights',
           worker: { env: { ...process.env, APPLICATION_INSIGHTS_NO_STATSBEAT: 'disable' } },
           options: { connectionString, config: { maxBatchSize: 1 } },
         },
       ],
     });
     ```

### Connection string vs bare instrumentation key

- v2 accepts either a full `InstrumentationKey=…;IngestionEndpoint=…;…` connection string **or** a bare instrumentation key (UUID).
- v3's `TelemetryClient` constructor only accepts the full connection string and throws if given a bare key. Always pass the full string for cross-version code.

### Endpoint URL

- v2 exposes the full `endpointUrl` (including `/v2.1/track`) on `client.config.endpointUrl`.
- v3 dropped that field. The library and `FakeApplicationInsights` parse the connection string themselves (see `src/connection-string.js`) — there is no public lookup on the v3 client.

### `Contracts.ContextTagKeys`

- v2 ships `Contracts.ContextTagKeys` as a constructor (`new Contracts.ContextTagKeys()`).
- v3 dropped that export. The same key strings are still available on every `TelemetryClient` instance via `client.context.keys`. Prefer `client.context.keys` in new code — it works on both versions.

### Exception envelopes

The v2 and v3 SDKs format `ExceptionData` envelopes differently:

| Field                        | v2                                                     | v3                                                                                                     |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `exceptions[i].hasFullStack` | `true` for fully-parsed stacks                         | not emitted                                                                                            |
| `exceptions[i].typeName`     | error class name                                       | error class name                                                                                       |
| `exceptions[i].parsedStack`  | array of `{ fileName, line, method, assembly, level }` | array with similar fields but a different shape and ordering — don't depend on field-by-field equality |

If you assert against captured exception envelopes in tests, gate v2-specific fields behind a version check (or use `mock.method` against `TelemetryClient.prototype.trackException` to assert at the SDK API surface instead of the wire — see `test/src/module-mock-test.js` for the pattern).
