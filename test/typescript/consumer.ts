import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import type { TelemetryClient } from 'applicationinsights';
import type { MetricTelemetry } from 'applicationinsights/out/Declarations/Contracts/index.js';

import compose from '@0dep/pino-applicationinsights';
import { FakeApplicationInsights } from '@0dep/pino-applicationinsights/fake-applicationinsights';
import type { LogTelemetry } from '../../types/interfaces.js';

const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

export const fakeAI = new FakeApplicationInsights(connectionString);

export function trackTrace() {
  const transport = compose({
    track(chunk) {
      const { time, severity, msg: message, properties } = chunk;
      this.trackTrace({ time, severity, message, properties });
    },
    connectionString,
    config: { maxBatchSize: 1, disableStatsbeat: true },
  });
  const logger = pino(transport);

  const expectMessage = fakeAI.expectMessageData();
  logger.info({ bar: 'baz' }, 'foo');
  transport.destroy();

  return expectMessage;
}

export function trackEvent() {
  const transport = compose({
    track(chunk) {
      const { time, properties } = chunk;
      this.trackEvent({ name: 'my event', time, properties, measurements: { logins: 1 } });
    },
    connectionString,
    config: { maxBatchSize: 1, disableStatsbeat: true },
  });
  const logger = pino(transport);

  const expectEvent = fakeAI.expectEventData();
  logger.info({ bar: 'baz' }, 'foo');
  transport.destroy();

  return expectEvent;
}

export function batchOfThree() {
  const transport = compose({
    track(chunk) {
      const { time, severity, msg: message, properties } = chunk;
      this.trackTrace({ time, severity, message, properties });
    },
    connectionString,
    config: { maxBatchSize: 3, disableStatsbeat: true },
  });
  const logger = pino({ level: 'trace' }, transport);

  const expectThree = fakeAI.expect(3);
  logger.info({ userid: 'bar' }, 'foo 0');
  logger.info({ userid: 'bar' }, 'foo 1');
  logger.info({ userid: 'bar' }, 'foo 2');

  return expectThree;
}

export function trackedClient(): Promise<TelemetryClient> {
  return new Promise<TelemetryClient>((resolve) => {
    const transport = compose({
      track(chunk) {
        resolve(this);
        const { time, severity, msg: message, properties } = chunk;
        this.trackTrace({ time, severity, message, properties });
      },
      connectionString,
      config: { disableStatsbeat: true },
    });
    const logger = pino({ level: 'trace' }, transport);
    logger.info({ userid: 'bar' }, 'foo 0');
  });
}

export function trackMetric() {
  const transport = compose({
    track(chunk: LogTelemetry & Partial<MetricTelemetry>) {
      const { time, msg, value = 0, count } = chunk;
      this.trackMetric({ time, name: msg, value, count });
    },
    connectionString,
    config: { maxBatchSize: 1, disableStatsbeat: true },
  });
  const logger = pino({ level: 'trace' }, transport);

  const expectMetric = fakeAI.expectTelemetryType('MetricData');
  logger.info({ value: 1, count: 1 }, 'foo');
  transport.destroy();

  return expectMetric;
}

export function customDestination() {
  return compose({ destination: process.stdout, ignoreKeys: ['pid', 'hostname'] });
}
