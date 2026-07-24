import { mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';

import { mockApplicationinsights } from '../helpers/mock-module.js';

const composeUrl = import.meta.resolve('@0dep/pino-applicationinsights');
const fakeAIUrl = import.meta.resolve('@0dep/pino-applicationinsights/fake-applicationinsights');

let cacheBust = 0;

['applicationinsights', 'applicationinsights-v3'].forEach((version) => {
  describe(`fake applicationinsights against ${version}`, () => {
    const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

    /** @type {(opts: any) => any} */
    let compose;

    /** @type {import('@0dep/pino-applicationinsights/fake-applicationinsights').FakeApplicationInsights} */
    let fakeAI;
    before(async () => {
      const ai = await import(version);
      const TelemetryClient = ai.TelemetryClient;
      mockApplicationinsights(ai);

      const bust = `?fai-v=${version}-${++cacheBust}`;
      compose = (await import(`${composeUrl}${bust}`)).default;
      const { FakeApplicationInsights } = await import(`${fakeAIUrl}${bust}`);

      const flushState = { chain: Promise.resolve() };
      for (const method of ['trackTrace', 'trackException', 'trackEvent', 'trackMetric']) {
        const original = TelemetryClient.prototype[method];
        if (typeof original !== 'function') continue;
        mock.method(TelemetryClient.prototype, method, function autoFlush(...args) {
          const result = original.apply(this, args);
          if (typeof this.flush === 'function') flushState.chain = flushState.chain.then(() => this.flush()).catch(() => {});
          return result;
        });
      }

      fakeAI = new FakeApplicationInsights(connectionString);
    });
    after(() => {
      mock.restoreAll();
    });
    afterEach(() => {
      fakeAI.reset();
    });

    it('constructor handles a TelemetryClient that lacks getStatsbeat', async () => {
      const ai = await import(version);
      const original = Object.getOwnPropertyDescriptor(ai.TelemetryClient.prototype, 'getStatsbeat');
      Object.defineProperty(ai.TelemetryClient.prototype, 'getStatsbeat', { value: undefined, configurable: true, writable: true });
      try {
        const { FakeApplicationInsights } = await import(`${fakeAIUrl}?fai-no-statsbeat=${++cacheBust}`);
        const fai = new FakeApplicationInsights(connectionString);
        expect(fai.client).to.be.ok;
        expect(typeof fai.client.getStatsbeat).to.equal('undefined');
        fai.reset();
      } finally {
        if (original) Object.defineProperty(ai.TelemetryClient.prototype, 'getStatsbeat', original);
        else delete ai.TelemetryClient.prototype.getStatsbeat;
      }
    });

    it('dispatcher matcher returns false for an empty body and the fallback replies with the Breeze success envelope', async () => {
      const tracked = fakeAI.expectMessageData();

      const empty = await fetch(`${fakeAI._endpointURL.origin}${fakeAI._endpointPathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-json-stream' },
        body: '',
      });
      expect(empty.status).to.equal(200);
      const emptyBody = await empty.json();
      expect(emptyBody).to.deep.include({ itemsReceived: 1, itemsAccepted: 1, errors: [] });

      const transport = compose({ connectionString, config: { maxBatchSize: 1, disableStatsbeat: true } });
      pino(transport).info('post-empty');
      const msg = await tracked;
      expect(msg.body.data.baseData.message).to.equal('post-empty');
      transport.destroy();
    });

    it(`FakeApplicationInsights's internal TelemetryClient is the ${version} version`, () => {
      const v3Only = typeof fakeAI.client.flush === 'function' && fakeAI.client.getStatsbeat() === null;
      expect(v3Only, `${version}: v3 sentinel = getStatsbeat() returns null`).to.equal(version === 'applicationinsights-v3');
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

        const msgs = await Promise.all([expectMessage1, expectException, expectMessage2]);

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

      it('resolves with at least the requested count when many items are tracked', async () => {
        const transport = compose({
          connectionString,
          config: { maxBatchSize: 1, disableStatsbeat: true },
        });

        const logger = pino(transport);

        const tracked = fakeAI.expect(8);

        for (let i = 0; i < 12; i++) {
          logger.info(`foo ${i}`);
        }

        const msgs = await tracked;

        expect(msgs).to.have.length.gte(8);
      });
    });
  });
});
