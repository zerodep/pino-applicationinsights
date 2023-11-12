# pino applicationinsights transport

[![Build](https://github.com/zerodep/pino-applicationinsights/actions/workflows/build.yaml/badge.svg)](https://github.com/zerodep/pino-applicationinsights/actions/workflows/build.yaml)[![Coverage Status](https://coveralls.io/repos/github/zerodep/pino-applicationinsights/badge.svg?branch=default)](https://coveralls.io/github/zerodep/pino-applicationinsights?branch=default)

Forward pino logger to Application Insights.

## Usage

```js
import { pino } from 'pino';
import compose from '@zerodep/pino-applicationinsights';

const transport = compose({
  track(chunk) {
    const { time, severity, msg: message, properties, exception } = chunk;
    this.trackTrace({ time, severity, message, properties });
    if (exception) this.trackException({ time, exception, severity });
  },
  connectionString,
  config: { maxBatchSize: 1 },
});

const logger = pino({ level: 'trace' }, transport);
```

## API

### `compose(opts[, TelemetryTransformation]) => Stream`

Build transport stream function.

- `opts`:
  * `track(chunk)`: track function called with Telemetry client context
    - `chunk`: [Telemetry:ish](#telemetrish-object) object
  * `connectionString`: Application Insights connection string or instrumentation key
  * `config`: optional Application Insights Telemetry client config
  * `destination`: optional destination stream, makes build ignore the above options
  * `ignoreKeys`: optional pino ignore keys, used to filter telemetry properties, defaults to `['hostname', 'pid', 'level', 'time', 'msg']`
- `TelemetryTransformation`: optional transformation stream extending [TelemetryTransformation](#class-telemetrytransformationoptions-config)

### `class TelemetryTransformation(options[, config])`

Telemetry transformation stream. Transforms pino log record to [Telemetry:ish](#telemetrish-object) object.

- `constructor(options[, config])`
  * `options`: transform stream options, `{ objectMode: true }` is always set
  * `config`: optional config object
    - `ignoreKeys`: optional pino ignore keys as string array
- `_transform(chunk, encoding, callback)`
- `convertToTelemetry(chunk)`: convert pino log record string or object to [telemetry:ish object](#telemetrish-object)
- `convertLevel(level)`: map pino log level number to `Contracts.SeverityLevel`
- `extractProperties(line, ignoreKeys)`: extract properties from log line
  * `line`: log line record object
  * `ignoreKeys`: configured ignore keys
- properties:
  * `ignoreKeys`: configured ignore keys, defaults to `['hostname', 'pid', 'level', 'time', 'msg']`

#### Telemetrish object

- `severity`: pino log level mapped to application insights severeity level, i.e. `Contracts.SeverityLevel`
- `msg`: log message string
- `properties`: telemetry properties object, filtered through ignore keys
- `exception?`: logged Error if any
- `[k: string]`: any other properties that facilitate telemetry logging

### `class FakeApplicationInsights(setupString)`

Intercept calls to application insights.

- `constructor(setupString);`
  * `setupString`: Fake application insights connection string
- `expectMessageData()`: Expect tracked message, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectEventData()`: Expect tracked event, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectExceptionData()`: Expect tracked exception, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectEventType(telemetryType: string)`: Expect tracked telemetry type, returns [`Promise<FakeCollectData>`](#fakecollectdata)
  * `telemetryType`: Telemetry type string
- `expect(count = 1)`: Expect tracked telemetrys, returns promise with list of [`FakeCollectData`](#fakecollectdata)
  * `count`: wait for at least tracked telemetrys before returning, default is 1
- `reset()`: Reset expected faked Application Insights calls, calls `nock.cleanAll`
- properties:
  * `client`: TelemetryClient, used to get endpoint URL
  *  `_endpointURL`: endpoint URL
  * `_scope`: nock Scope

#### Example

```js
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';

import compose from '@0dep/pino-applicationinsights';
import { FakeApplicationInsights } from '@0dep/pino-applicationinsights/fake-applicationinsights.js';

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
  * `ver`: some version number, usually 1
  * `sampleRate`: sample rate number, usually 100
  * `tags`: object with tags, tag names can be inspected under `TelemetryClient.context.keys`, e.g:
    - `ai.application.ver`: your package.json version
    - `ai.device.id`: ?
    - `ai.cloud.roleInstance`: computer hostname?
    - `ai.device.osVersion`: computer os
    - `ai.cloud.role`: Web maybe?
    - `ai.device.osArchitecture`: probably x64
    - `ai.device.osPlatform`: os platform, as the name says
    - `ai.internal.sdkVersion`: applicationinsights package version, e.g. `node:2.9.1`
    - `[tag name]`: any other tag found under `TelemetryClient.context.keys`
  * `data`:
      - `baseType`: telemetry type string
      - `baseData`:
        * `ver`: some version number, usually 2 for some reason
        * `properties`: telemetry properties object
        * `[message]`: logged message when tracking trace
        * `[severityLevel]`: applicationinsights severity level number when tracking trace and exception
        * `[exceptions]`: list of exceptions when tracking exception
          - `message`: error message
          - `hasFullStack`: boolean, true
          - `parsedStack`: stack parsed as objects
        * `[x: string]`: any other telemetry property
- `iKey`: applicationinsights instrumentation key
- `name`: some ms name with iKey and the tracked type
- `time`: log time
