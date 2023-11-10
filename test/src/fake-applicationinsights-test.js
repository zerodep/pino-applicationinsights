import { randomUUID } from 'node:crypto';
import { pino } from 'pino';

import compose from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';

describe('fake applicationinsights', () => {
  const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

  let fakeAI;
  before(() => {
    fakeAI = new FakeApplicationInsights(connectionString);
  });
  after(() => {
    fakeAI.reset();
  });

  it('log with track event catches event record', async () => {
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

  it('log with track event catches first event record', async () => {
    const transport = compose({
      track(chunk) {
        const { time, properties } = chunk;
        this.trackEvent({ name: 'my event', time, properties, measurements: { logins: 1 } });
      },
      connectionString,
      config: { maxBatchSize: 2, disableStatsbeat: true },
    });
    const logger = pino(transport);

    const expectMessage = fakeAI.expectEventData();

    logger.info({ bar: 'baz' }, 'foo');
    logger.warn({ bar: 'baz' }, 'warning');

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.deep.include({
      properties: { bar: 'baz' },
      measurements: { logins: 1 },
      name: 'my event',
    });

    transport.destroy();
  });
});
