import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import nock from 'nock';

import compose from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';

describe('fake applicationinsights', () => {
  const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

  /** @type {FakeApplicationInsights} */
  let fakeAI;
  before(() => {
    fakeAI = new FakeApplicationInsights(connectionString);
  });
  afterEach(() => {
    fakeAI.reset();
  });

  describe('catches tracking', () => {
    it('expect exception and traces', async () => {
      const transport = compose({
        connectionString,
        config: { maxBatchSize: 1, disableStatsbeat: true },
      });
      const logger = pino(transport);

      const expectException = fakeAI.expectExceptionData();
      const expectMessage1 = fakeAI.expectMessageData();
      const expectMessage2 = fakeAI.expectMessageData();

      logger.error(new Error('bar'), 'foo');
      logger.info('baz');

      const msgs = await Promise.all([ expectMessage1, expectException, expectMessage2 ]);

      expect(msgs[0].body.data.baseType, '# 0').to.equal('MessageData');
      expect(msgs[0].body.data.baseData.message, '# 1').to.equal('foo');
      expect(msgs[1].body.data.baseType, '# 1').to.equal('ExceptionData');
      expect(msgs[2].body.data.baseType, '# 2').to.equal('MessageData');
      expect(msgs[2].body.data.baseData.message, '# 1').to.equal('baz');
    });
  });

  describe('expectEventData', () => {
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

  describe('expect(count)', () => {
    it('defaults to 1 and is resolved when one call has completed', async () => {
      const transport = compose({
        connectionString,
        config: { maxBatchSize: 1, disableStatsbeat: true },
      });

      const logger = pino(transport);

      const tracked = fakeAI.expect();

      logger.info('foo 0');

      const msgs = await tracked;

      expect(msgs).to.have.length(1);
    });

    it('maxBatchSize=3 resolves when count is passed', async () => {
      const transport = compose({
        connectionString,
        config: { maxBatchSize: 3, disableStatsbeat: true },
      });

      const logger = pino(transport);

      const tracked = fakeAI.expect(8);

      const ingestion = new Promise((resolve) => {
        let ingestCount = 1;
        nock('https://ingestion.local')
          .post('/v2.1/track')
          .times(ingestCount)
          .reply(() => {
            if (!--ingestCount) resolve();
            return [ 200 ];
          });
      });

      for (let i = 0; i < 12; i++) {
        logger.info(`foo ${i}`);
      }

      const msgs = await tracked;

      expect(msgs).to.have.length(9);

      await ingestion;
    });

    it('maxBatchSize=1 resolves when exact count is reached', async () => {
      const transport = compose({
        connectionString,
        config: { maxBatchSize: 1, disableStatsbeat: true },
      });

      const logger = pino(transport);

      const tracked = fakeAI.expect(8);

      const ingested = new Promise((resolve) => {
        let ingestCount = 4;
        nock('https://ingestion.local')
          .post('/v2.1/track')
          .times(ingestCount)
          .reply(() => {
            if (!--ingestCount) resolve();
            return [ 200 ];
          });
      });

      for (let i = 0; i < 12; i++) {
        logger.info(`foo ${i}`);
      }

      const msgs = await tracked;

      expect(msgs).to.have.length(8);

      await ingested;
    });
  });
});
