import { mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';

import { FakeApplicationInsights } from '@0dep/pino-applicationinsights/fake-applicationinsights';
import { mockApplicationinsights } from '../helpers/mock-module.js';

const composeUrl = import.meta.resolve('@0dep/pino-applicationinsights');

let cacheBust = 0;

['applicationinsights', 'applicationinsights-v3'].forEach((version) => {
  describe(`flushes buffered records on close (${version})`, () => {
    const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;
    /** @type {(opts: any) => any} */
    let compose;
    /** @type {FakeApplicationInsights} */
    let fakeAI;

    before(async () => {
      const ai = await import(version);
      mockApplicationinsights(ai);
      compose = (await import(`${composeUrl}?close-v=${version}-${++cacheBust}`)).default;
    });

    after(() => {
      mock.restoreAll();
    });

    afterEach(() => {
      fakeAI?.reset();
    });

    it('forwards every buffered record to Application Insights when the pino logger is closed', async () => {
      fakeAI = new FakeApplicationInsights(connectionString);

      const transport = compose({ connectionString, config: { disableStatsbeat: true } });
      const logger = pino({ level: 'trace' }, transport);

      const count = 5;
      const expected = fakeAI.expect(count);

      for (let i = 0; i < count; i++) {
        logger.info({ idx: i }, `buffered-${i}`);
      }

      transport.end();

      const msgs = await expected;

      expect(msgs).to.have.lengthOf.at.least(count);
      const messages = msgs.map((m) => m.body.data.baseData.message).filter((m) => m?.startsWith('buffered-'));
      expect(messages).to.have.members(['buffered-0', 'buffered-1', 'buffered-2', 'buffered-3', 'buffered-4']);
    });
  });
});
