import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { expect } from 'chai';

import build from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';

describe('log transport', () => {
  const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;
  let fakeAI: FakeApplicationInsights;
  before(() => {
    fakeAI = new FakeApplicationInsights(connectionString);
  });
  after(() => {
    fakeAI.reset();
  });

  it('log with track trace write trace record', async () => {
    const transport = build({
      track(chunk) {
        const { time, severity, msg: message, properties } = chunk;
        this.trackTrace({ time, severity, message, properties });
      },
      connectionString,
      config: { maxBatchSize: 1 },
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
    const transport = build({
      track(chunk) {
        const { time, properties } = chunk;
        this.trackEvent({ name: 'my event', time, properties, measurements: { logins: 1 } });
      },
      connectionString,
      config: { maxBatchSize: 1 },
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

    const transport = build({
      track(chunk) {
        const { time, severity, msg: message, properties } = chunk;
        this.trackTrace({ time, severity, message, properties });
      },
      connectionString,
      config: { maxBatchSize: 3 },
    });

    const logger = pino({ level: 'trace' }, transport);

    logger.info({ userid: 'bar' }, 'foo 0');
    logger.info({ userid: 'bar' }, 'foo 1');
    logger.info({ userid: 'bar' }, 'foo 2');

    const msgs = await expectThree;

    expect(msgs[2].body.data.baseData.message).to.equal('foo 2');
  });
});
