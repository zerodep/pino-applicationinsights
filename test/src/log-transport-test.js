import { mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import * as ck from 'chronokinesis';

import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';

const filePath = fileURLToPath(import.meta.url);

const wireSeverity = {
  applicationinsights: { Verbose: 0, Information: 1, Warning: 2, Error: 3, Critical: 4 },
  'applicationinsights-v3': { Verbose: 'Verbose', Information: 'Information', Warning: 'Warning', Error: 'Error', Critical: 'Critical' },
};

let cacheBust = 0;

['applicationinsights', 'applicationinsights-v3'].forEach((version) => {
  describe(`log transport ${version}`, () => {
    const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

    const SeverityLevel = wireSeverity[version];
    let logger;
    let transport;
    let fakeAI;
    let tagKeys;
    let TelemetryClient;

    const frozen = new Date('2099-01-01T00:00:00.000Z');

    before(async () => {
      ck.freeze(frozen);

      const ai = await import(version);
      TelemetryClient = ai.TelemetryClient;
      mock.module('applicationinsights', { cache: false, namedExports: ai });
      const compose = (await import(`../../src/index.js?v=${version}-${++cacheBust}`)).default;

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

      const probe = new TelemetryClient(connectionString);
      tagKeys = probe.context.keys;

      fakeAI = new FakeApplicationInsights(connectionString);

      transport = compose({
        connectionString,
        config: { maxBatchSize: 1, disableStatsbeat: true },
      });

      logger = pino({ level: 'trace', mixin }, transport);
    });

    after(() => {
      transport.destroy();
      fakeAI.reset();
      mock.restoreAll();
      ck.reset();
    });

    function mixin(context) {
      return { tagOverrides: { [tagKeys.userId]: 'uzer', ...context.tagOverrides } };
    }

    it('logs debug', async () => {
      const expectMessage = fakeAI.expectMessageData();

      logger.debug({ bar: 'baz' }, 'foo');

      const msg = await expectMessage;

      expect(msg.body.data.baseData).to.deep.include({ severityLevel: SeverityLevel.Verbose, message: 'foo' });
    });

    it('logs info', async () => {
      const expectMessage = fakeAI.expectMessageData();

      logger.info({ bar: 'baz' }, 'foo');

      const msg = await expectMessage;

      expect(msg.body.data.baseData).to.deep.include({ severityLevel: SeverityLevel.Information, message: 'foo' });
    });

    it('logs warn', async () => {
      const expectMessage = fakeAI.expectMessageData();

      logger.warn({ bar: 'baz' }, 'foo');

      const msg = await expectMessage;

      expect(msg.body.data.baseData).to.deep.include({ severityLevel: SeverityLevel.Warning, message: 'foo' });
    });

    it('logs error', async () => {
      const expectMessage = fakeAI.expectMessageData();
      const expectException = fakeAI.expectExceptionData();

      logger.error(new Error('bar'), 'foo');

      const msg = await expectMessage;

      expect(msg.body.data.baseData).to.deep.include({ severityLevel: SeverityLevel.Error, message: 'foo' });

      const err = await expectException;

      expect(err.body.data.baseData).to.have.property('severityLevel', SeverityLevel.Error);
      expect(err.body.data.baseData).to.have.property('exceptions').with.length(1);
      expect(err.body.data.baseData.exceptions[0]).to.include({ message: 'bar' });
    });

    it('logs fatal', async () => {
      const expectMessage = fakeAI.expectMessageData();
      const expectException = fakeAI.expectExceptionData();

      logger.fatal(new Error('bar'), 'foo');

      const msg = await expectMessage;

      expect(msg.body.data.baseData).to.deep.include({ severityLevel: SeverityLevel.Critical, message: 'foo' });

      const err = await expectException;

      expect(err.body.data.baseData).to.have.property('severityLevel', SeverityLevel.Critical);
      expect(err.body.data.baseData).to.have.property('exceptions').with.length(1);
      expect(err.body.data.baseData.exceptions[0]).to.include({ typeName: 'Error', message: 'bar' });
    });

    it('logs time extracted from log record', async () => {
      const expectMessage = fakeAI.expectMessageData();

      logger.info('foo');

      const msg = await expectMessage;

      expect(msg.body.time).to.equal(frozen.toISOString());
    });

    describe('tracing', () => {
      const traceId = '0af7651916cd43dd8448eb211c80319c';
      const spanId = 'b7ad6b7169203331';

      it('forwards tracing.traceId/spanId as operation id tags on the wire envelope', async () => {
        const expectMessage = fakeAI.expectMessageData();

        logger.info({ bar: 'baz', tracing: { traceId, spanId } }, 'foo');

        const msg = await expectMessage;

        expect(msg.body.tags).to.include({ [tagKeys.operationId]: traceId, [tagKeys.operationParentId]: spanId });
      });

      it('forwards tracing on both trace and exception envelopes', async () => {
        const expectMessage = fakeAI.expectMessageData();
        const expectException = fakeAI.expectExceptionData();

        logger.error({ tracing: { traceId, spanId }, err: new Error('boom') }, 'boom');

        const msg = await expectMessage;
        const err = await expectException;

        expect(msg.body.tags).to.include({ [tagKeys.operationId]: traceId, [tagKeys.operationParentId]: spanId });
        expect(err.body.tags).to.include({ [tagKeys.operationId]: traceId, [tagKeys.operationParentId]: spanId });
      });

      it('does not leak tracing into envelope properties', async () => {
        const expectMessage = fakeAI.expectMessageData();

        logger.info({ bar: 'baz', tracing: { traceId, spanId } }, 'foo');

        const msg = await expectMessage;

        expect(msg.body.data.baseData.properties).to.deep.equal({ bar: 'baz' });
      });

      if (version === 'applicationinsights') {
        it('user-supplied tagOverrides win over auto-derived tracing ids', async () => {
          const expectMessage = fakeAI.expectMessageData();

          logger.info({ bar: 'baz', tracing: { traceId, spanId }, tagOverrides: { [tagKeys.operationId]: 'user-override' } }, 'foo');

          const msg = await expectMessage;

          expect(msg.body.tags).to.include({
            [tagKeys.operationId]: 'user-override',
            [tagKeys.operationParentId]: spanId,
          });
        });
      }

      it('log without tracing leaves operation tags untouched', async () => {
        const expectMessage = fakeAI.expectMessageData();

        logger.info({ bar: 'baz' }, 'foo');

        const msg = await expectMessage;

        expect(msg.body.tags).to.not.have.property(tagKeys.operationId);
      });
    });

    if (version === 'applicationinsights') {
      it('logs info with tag overrides', async () => {
        const expectMessage = fakeAI.expectMessageData();

        logger.info({ bar: 'baz', tagOverrides: { [tagKeys.userAuthUserId]: 'Jan Bananberg' } }, 'foo');

        const msg = await expectMessage;

        expect(msg.body.tags).to.deep.include({ [tagKeys.userAuthUserId]: 'Jan Bananberg' });
      });

      it('log error logs exception with stack', async () => {
        const expectMessage = fakeAI.expectMessageData();
        const expectException = fakeAI.expectExceptionData();

        const error = new TypeError('bar');
        error.code = 'ERR_TEST';

        logger.error(error, 'foo');

        await expectMessage;

        const err = await expectException;

        expect(err.body.data.baseData).to.have.property('exceptions').with.length(1);

        const [exception] = err.body.data.baseData.exceptions;

        expect(exception).to.deep.include({ typeName: 'TypeError', hasFullStack: true, message: 'bar' });
        expect(exception).to.have.property('parsedStack').with.property('length').that.is.above(0);
        expect(exception.parsedStack[0].fileName, 'stack file name').to.include(filePath);
      });

      it('logs exception with tag overrides', async () => {
        const expectMessage = fakeAI.expectMessageData();
        const expectException = fakeAI.expectExceptionData();

        logger.error(new Error('bar'), 'foo');

        const msg = await expectMessage;

        expect(msg.body.tags).to.deep.include({ [tagKeys.userId]: 'uzer' });

        const err = await expectException;

        expect(err.body.tags).to.deep.include({ [tagKeys.userId]: 'uzer' });
      });
    }
  });
});
