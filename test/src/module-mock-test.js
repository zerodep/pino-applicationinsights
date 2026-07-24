import { mock } from 'node:test';
import { pino } from 'pino';

import { mockApplicationinsights } from '../helpers/mock-module.js';

const composeUrl = import.meta.resolve('@0dep/pino-applicationinsights');
const connectionString = 'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://ingestion.local';

function tick() {
  return new Promise((r) => setImmediate(r));
}

['applicationinsights', 'applicationinsights-v3'].forEach((version) => {
  describe(`compose with ${version}`, () => {
    /** @type {(opts: any) => any} */
    let compose;
    /** @type {any} */
    let TelemetryClient;
    /** @type {ReturnType<typeof mock.module>} */
    let moduleMock;

    beforeEach(async () => {
      const ai = await import(version);
      TelemetryClient = ai.TelemetryClient;
      moduleMock = mockApplicationinsights(ai);
      compose = (await import(`${composeUrl}?v=${version}-${++cacheBust}`)).default;
    });

    afterEach(() => {
      mock.restoreAll();
      moduleMock.restore();
    });

    it('constructs a TelemetryClient from the mocked module', async () => {
      const ctorSpy = mock.method(TelemetryClient.prototype, 'trackTrace', () => {});

      const transport = compose({
        connectionString,
        config: { maxBatchSize: 1, disableStatsbeat: true },
      });
      const logger = pino(transport);

      logger.info({ kind: version }, 'hello');
      for (let i = 0; i < 20 && ctorSpy.mock.callCount() === 0; i++) await tick();
      transport.destroy();

      expect(ctorSpy.mock.callCount(), 'trackTrace called once').to.equal(1);
      const [telemetry] = ctorSpy.mock.calls[0].arguments;
      expect(telemetry).to.include({ message: 'hello' });
      expect(telemetry.properties).to.deep.equal({ kind: version });
    });

    it('routes errors to trackException as well as trackTrace', async () => {
      const traceSpy = mock.method(TelemetryClient.prototype, 'trackTrace', () => {});
      const exceptionSpy = mock.method(TelemetryClient.prototype, 'trackException', () => {});

      const transport = compose({
        connectionString,
        config: { maxBatchSize: 1, disableStatsbeat: true },
      });
      const logger = pino({ level: 'trace' }, transport);

      logger.error(new Error('boom'), 'kaboom');
      for (let i = 0; i < 20 && exceptionSpy.mock.callCount() === 0; i++) await tick();
      transport.destroy();

      expect(traceSpy.mock.callCount(), 'trackTrace called for the message').to.equal(1);
      expect(exceptionSpy.mock.callCount(), 'trackException called for the error').to.equal(1);
      expect(traceSpy.mock.calls[0].arguments[0]).to.include({ message: 'kaboom' });
      expect(exceptionSpy.mock.calls[0].arguments[0].exception).to.be.an('error').with.property('message', 'boom');
    });

    it('disables statsbeat via getStatsbeat() on v2; no-op on v3', async () => {
      const trackSpy = mock.method(TelemetryClient.prototype, 'trackTrace', () => {});

      const statsbeats = [];
      if (typeof TelemetryClient.prototype.getStatsbeat === 'function') {
        const original = TelemetryClient.prototype.getStatsbeat;
        mock.method(TelemetryClient.prototype, 'getStatsbeat', function getStatsbeat() {
          const sb = original.call(this);
          statsbeats.push(sb);
          return sb;
        });
      }

      const transport = compose({
        connectionString,
        config: { maxBatchSize: 1, disableStatsbeat: true },
      });
      const logger = pino(transport);

      logger.info('hi');
      for (let i = 0; i < 20 && trackSpy.mock.callCount() === 0; i++) await tick();
      transport.destroy();

      const realStatsbeat = statsbeats.find((sb) => sb && typeof sb.isEnabled === 'function');
      if (realStatsbeat) {
        expect(realStatsbeat.isEnabled(), `${version}: v2 statsbeat must be disabled`).to.equal(false);
      } else {
        expect(realStatsbeat, `${version}: v3 has no statsbeat instance to disable (no-op)`).to.equal(undefined);
      }
    });
  });
});

let cacheBust = 0;
