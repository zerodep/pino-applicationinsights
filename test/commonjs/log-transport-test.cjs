'use strict';

const { randomUUID } = require('node:crypto');
const pino = require('pino');

const compose = require('../../lib/index.cjs');
const { FakeApplicationInsights } = require('../../lib/fake-applicationinsights.cjs');

describe('log transport', () => {
  describe('with connection string', () => {
    const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;
    let fakeAI;
    before(() => {
      fakeAI = new FakeApplicationInsights(connectionString);
    });
    after(() => {
      fakeAI.reset();
    });

    it('connection string', async () => {
      const transport = compose({
        track(chunk) {
          const { time, severity, msg: message, properties } = chunk;
          this.trackTrace({ time, severity, message, properties });
        },
        connectionString,
        config: { maxBatchSize: 1, disableStatsBeat: true },
      });
      const logger = pino(transport);

      const expectMessage = fakeAI.expectMessageData();

      logger.info({ bar: 'baz' }, 'foo');

      const msg = await expectMessage;

      expect(msg.body.data.baseData).to.have.property('message', 'foo');
      expect(msg.body.data.baseData).to.have.property('properties').that.deep.equal({ bar: 'baz' });

      transport.destroy();
    });
  });
});
