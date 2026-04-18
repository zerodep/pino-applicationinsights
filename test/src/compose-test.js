import { Writable } from 'node:stream';
import { mock } from 'node:test';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';

import compose from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';

let cacheBust = 0;

describe('compose', () => {
  describe('options', () => {
    it('compose with destination stream pipes to destination', () => {
      const msgs = [];

      const destination = new Writable({
        autoDestroy: true,
        objectMode: true,
        write(chunk, _encoding, callback) {
          msgs.push(chunk);
          callback();
        },
      });

      const transport = compose({ destination });

      const logger = pino(transport);

      logger.info('foo');

      expect(msgs).to.have.length(1);

      transport.destroy();
    });

    it('ignore keys filters telemetry properties', () => {
      const msgs = [];

      const transport = compose({
        ignoreKeys: ['pid', 'hostname', 'level', 'msg', 'bar', 'time'],
        destination: new Writable({
          autoDestroy: true,
          objectMode: true,
          write(chunk, _encoding, callback) {
            msgs.push(chunk);
            callback();
          },
        }),
      });

      const logger = pino(transport);

      logger.info({ bar: 'baz', my: 'prop' }, 'foo');

      expect(msgs[0].properties).to.deep.equal({ my: 'prop' });

      transport.destroy();
    });

    it('without connection string throws', () => {
      expect(() => {
        compose({ track() {} });
      }).to.throw(TypeError, /connectionString/);
    });

    it('with track function but without connection string throws', () => {
      expect(() => {
        compose({ track() {} });
      }).to.throw(TypeError, /connectionString/);
    });

    it('with connection string and non-function track throws', () => {
      expect(() => {
        compose({ track: {} });
      }).to.throw(TypeError, /connectionString/);
    });

    it('with destination not a Writable stream throws', () => {
      expect(() => {
        compose({ destination: {} });
      }).to.throw(TypeError, /writable/);
    });
  });
});

['applicationinsights', 'applicationinsights-v3'].forEach((version) => {
  describe(`compose against ${version}`, () => {
    /** @type {(opts: any) => any} */
    let scopedCompose;
    let TelemetryClient;
    let isV2;

    before(async () => {
      const ai = await import(version);
      TelemetryClient = ai.TelemetryClient;
      mock.module('applicationinsights', { namedExports: ai, defaultExport: ai });
      scopedCompose = (await import(`../../src/index.js?compose-v=${version}-${++cacheBust}`)).default;

      for (const method of ['trackTrace', 'trackException', 'trackEvent', 'trackMetric']) {
        const original = TelemetryClient.prototype[method];
        if (typeof original !== 'function') continue;
        mock.method(TelemetryClient.prototype, method, function autoFlush(...args) {
          const result = original.apply(this, args);
          if (typeof this.flush === 'function') this.flush();
          return result;
        });
      }

      const probe = new TelemetryClient(`InstrumentationKey=${randomUUID()};IngestionEndpoint=https://probe.local`);
      isV2 = typeof probe.getStatsbeat === 'function' && probe.getStatsbeat() !== null;
    });
    after(() => {
      mock.restoreAll();
    });

    describe('setup with connection string', () => {
      const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

      let fakeAI;
      before(() => {
        fakeAI = new FakeApplicationInsights(connectionString);
      });
      after(() => {
        fakeAI.reset();
      });

      it('logs message to target', async () => {
        const transport = scopedCompose({
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
      });

      it('no TelemetryClient config is ok', () => {
        let client;
        const transport = scopedCompose({
          track(chunk) {
            client = this;
            const { time, severity, msg: message, properties } = chunk;
            this.trackTrace({ time, severity, message, properties });
          },
          connectionString,
        });
        const logger = pino(transport);

        logger.info({ bar: 'baz' }, 'foo');

        expect(client.config).to.be.ok;
        if (isV2) {
          expect(client.config).to.have.property('maxBatchSize').to.be.above(1);
        }
        transport.destroy();
      });

      it('config.disableStatsbeat=true does not throw on either version', () => {
        const transport = scopedCompose({
          track(chunk) {
            const { time, severity, msg: message, properties } = chunk;
            this.trackTrace({ time, severity, message, properties });
          },
          connectionString,
          config: { disableStatsbeat: true },
        });
        const logger = pino(transport);

        expect(() => logger.info({ bar: 'baz' }, 'foo')).to.not.throw();
        transport.destroy();
      });

      it('config.maxBatchSize is passed to telemetry client', async () => {
        const expectThree = fakeAI.expect(3);

        const transport = scopedCompose({
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

        expect(msgs).to.have.length(3);
      });
    });

    if (version === 'applicationinsights') {
      describe('setup with instrumentation key', () => {
        const instrumentationKey = randomUUID();
        let fakeAI;
        before(() => {
          fakeAI = new FakeApplicationInsights(instrumentationKey);
        });
        after(() => {
          fakeAI.reset();
        });

        it('logs message to target', async () => {
          const transport = scopedCompose({
            track(chunk) {
              const { time, severity, msg: message, properties } = chunk;
              this.trackTrace({ time, severity, message, properties });
            },
            connectionString: instrumentationKey,
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
    }

    describe('track function', () => {
      const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

      let fakeAI;
      before(() => {
        fakeAI = new FakeApplicationInsights(connectionString);
      });
      after(() => {
        fakeAI.reset();
      });

      it('is bound to telemetry client, e.g. client.context.keys', async () => {
        const expectMessage = fakeAI.expectMessageData();

        const transport = scopedCompose({
          track(chunk) {
            const { time, severity, msg: message, properties } = chunk;
            this.trackTrace({
              time,
              severity,
              message,
              properties,
              tagOverrides: { [this.context.keys.userId]: properties.userid },
            });
          },
          connectionString,
          config: { maxBatchSize: 1, disableStatsbeat: true },
        });

        const logger = pino({ level: 'trace' }, transport);

        logger.info({ userid: 'bar' }, 'foo');

        const { body } = await expectMessage;

        if (isV2) {
          expect(body.tags).to.have.property('ai.user.id', 'bar');
        } else {
          expect(body.data.baseData).to.have.property('properties').that.deep.include({ userid: 'bar' });
        }

        transport.destroy();
      });

      it('defaults to tracking trace and exception', async () => {
        const expectMessage = fakeAI.expectMessageData();
        const expectException = fakeAI.expectExceptionData();

        const transport = scopedCompose({
          connectionString,
          config: { maxBatchSize: 1, disableStatsbeat: true },
        });

        const logger = pino({ level: 'trace' }, transport);

        logger.error(new Error('bar'), 'foo');

        const msg = await expectMessage;

        expect(msg.body.data).to.have.property('baseType', 'MessageData');

        const err = await expectException;

        expect(err.body.data).to.have.property('baseType', 'ExceptionData');
      });
    });
  });
});
