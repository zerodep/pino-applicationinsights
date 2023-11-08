# pino applicationinsights transport

[![Build](https://github.com/zerodep/pino-applicationinsights/actions/workflows/build.yaml/badge.svg)](https://github.com/zerodep/pino-applicationinsights/actions/workflows/build.yaml)[![Coverage Status](https://coveralls.io/repos/github/zerodep/pino-applicationinsights/badge.svg?branch=default)](https://coveralls.io/github/zerodep/pino-applicationinsights?branch=default)

Forward pino logger to Application Insights.

## Usage

```js
import { pino } from 'pino';
import build from '@zerodep/pino-applicationinsights';

const transport = build({
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

### `build(opts[, TelemetryTransformation]) => Stream`

Build transport stream function.

- `opts`:
  * `track(chunk)`: track function called with Telemetry client context
  * `connectionString`: Application Insights connection string or instrumentation key
  * `config`: optional Application Insights Telemetry client config
  * `destination`: optional destination stream, makes build ignore the above options
  * `ignoreKeys`: optional pino ignore keys, defaults to `['hostname', 'pid', 'level', 'time', 'msg']`
- `TelemetryTransformation`: optional transformation stream extending [TelemetryTransformation](#class-telemetrytransformationoptions-config)

### `class TelemetryTransformation(options[, config])`

Telemetry transformation stream. Transforms pino log record to Telemetry:ish object.
