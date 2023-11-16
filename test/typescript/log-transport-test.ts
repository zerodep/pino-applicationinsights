import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { expect } from 'chai';
import { TelemetryClient } from 'applicationinsights';
import { MetricTelemetry } from 'applicationinsights/out/Declarations/Contracts/index.js';

import compose from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';
import { LogTelemetry } from '../../types/interfaces.js';

describe('log transport', () => {
  const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;
  let fakeAI: FakeApplicationInsights;
  before(() => {
    fakeAI = new FakeApplicationInsights(connectionString);
  });
  afterEach(() => {
    fakeAI.reset();
  });

  it('log with track trace write trace record', async () => {
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

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.have.property('message', 'foo');
    expect(msg.body.data.baseData).to.have.property('properties').that.deep.equal({ bar: 'baz' });

    transport.destroy();
  });

  it('log with track event write event record', async () => {
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

  it('config maxBatchSize is passed to TelemetryClient', async () => {
    const expectThree = fakeAI.expect(3);

    const transport = compose({
      track(chunk) {
        const { time, severity, msg: message, properties } = chunk;
        this.trackTrace({ time, severity, message, properties });
      },
      connectionString,
      config: { maxBatchSize: 3, disableStatsbeat: true },
    });

    const logger = pino({ level: 'trace' }, transport);

    logger.info({ userid: 'bar' }, 'foo 0');
    logger.info({ userid: 'bar' }, 'foo 1');
    logger.info({ userid: 'bar' }, 'foo 2');

    const msgs = await expectThree;

    expect(msgs[2].body.data.baseData.message).to.equal('foo 2');
    expect(msgs[0].body.data.baseData.properties.userid).to.equal('bar');
  });

  it('config disableStatsbeat is passed to TelemetryClient', async () => {
    const tracked = new Promise<TelemetryClient>((resolve) => {
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

    const client = await tracked;

    expect(client.getStatsbeat().isEnabled()).to.be.false;
  });

  it('fake application insights expect telemetry type', async () => {
    const expectTelemetry = fakeAI.expectTelemetryType('MetricData');

    const transport = compose({
      track(chunk: LogTelemetry & Partial<MetricTelemetry>) {
        const { time, msg, value = 0, count } = chunk;
        this.trackMetric({ time, name: msg, value, count });
      },
      connectionString,
      config: { maxBatchSize: 1, disableStatsbeat: true },
    });

    const logger = pino({ level: 'trace' }, transport);

    logger.info({ value: 1, count: 1 }, 'foo');

    const telemetry = await expectTelemetry;

    expect(telemetry.body.data.baseData.metrics[0]).to.have.property('name', 'foo');
  });
});
