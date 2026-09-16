'use strict';

const { randomUUID } = require('node:crypto');
const pino = require('pino');

const { default: compose } = require('@0dep/pino-applicationinsights');
const { FakeApplicationInsights } = require('@0dep/pino-applicationinsights/fake-applicationinsights');

describe('log transport', () => {
  describe('with connection string', () => {
    const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;
    /** @type {import('@0dep/pino-applicationinsights/fake-applicationinsights').FakeApplicationInsights} */
    let fakeAI;
    before(() => {
      fakeAI = new FakeApplicationInsights(connectionString);
    });
    after(() => {
      fakeAI.reset();
    });

    it('connection string', async () => {
      const transport = compose({
        /** @param {import('../../types/interfaces.js').LogTelemetry} chunk */
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
  });
});
