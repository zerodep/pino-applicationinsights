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
  * `ignoreKeys`: optional pino ignore keys, defaults to `['hostname', 'pid', 'level', 'time', 'msg']`
- `TelemetryTransformation`: optional transformation stream extending [TelemetryTransformation](#class-telemetrytransformationoptions-config)

### `class TelemetryTransformation(options[, config])`

Telemetry transformation stream. Transforms pino log record to [Telemetry:ish](#telemetrish-object) object.

#### Telemetrish object

- `severity`: pino log level mapped to application insights `Contracts.SeverityLevel`
- `msg`: log message string
- `properties`: telemetry properties object, filtered through ignore keys
- `exception?`: logged Error if any
- `[k: string]`: any other properties

### `class FakeApplicationInsights(setupString)`

Intercept calls to application insights.

- `constructor(setupString);`
  * `setupString`: Fake application insights connection string
- `expectMessageData()`: Expect tracked message, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectEventData()`: Expect tracked event, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectExceptionData()`: Expect tracked exception, returns [`Promise<FakeCollectData>`](#fakecollectdata)
- `expectEventType(telemetryType: string)`: Expect tracked telemetry type, returns [`Promise<FakeCollectData>`](#fakecollectdata)
  * `telemetryType`: Telemetry type string
- `expect(count = 1)`: Expect tracked telemetrys, returns list of [`Promise<FakeCollectData[]>`](#fakecollectdata)
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

- `uri`: string;
- `method`: string;
- `headers`: request headers object
- `body`:
  * `ver`: some version number
  * `sampleRate`: sample rate number
  * `tags`: object with tags
  * `data`:
      - `baseType`: telemetry type string
      - `baseData`:
        * `ver`: number
        * `properties`: telemetry properties object
        * `[x: string]`: any other telemetry
- `iKey`: instrumentation key string
- `name`: string
- `time`: log time
