import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';

import build from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';

describe('build', () => {
  describe('options', () => {
    it('build with destination stream pipes to destination', () => {
      const msgs = [];

      const destination = new Writable({
        autoDestroy: true,
        objectMode: true,
        write(chunk, _encoding, callback) {
          msgs.push(chunk);
          callback();
        },
      });

      const transport = build({ destination });

      const logger = pino(transport);

      logger.info('foo');

      expect(msgs).to.have.length(1);

      transport.destroy();
    });

    it('ignore keys filters log line properties', () => {
      const msgs = [];

      const transport = build({
        ignoreKeys: [ 'pid', 'hostname', 'level', 'msg', 'bar', 'time' ],
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
    });

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
        const transport = build({
          track(chunk) {
            const { time, severity, msg: message, properties } = chunk;
            this.trackTrace({ time, severity, message, properties });
          },
          connectionString: instrumentationKey,
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
    });

    it('without connection string throws', () => {
      expect(() => {
        build({ track() {} });
      }).to.throw(TypeError, /connectionString/);
    });

    it('with connection string but without track throws', () => {
      expect(() => {
        build({ track() {} });
      }).to.throw(TypeError, /connectionString/);
    });

    it('with destination not a Writable stream throws', () => {
      expect(() => {
        build({ destination: {} });
      }).to.throw(TypeError, /writable/);
    });
  });

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

      const transport = build({
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
        config: { maxBatchSize: 1 },
      });

      const logger = pino({ level: 'trace' }, transport);

      logger.info({ userid: 'bar' }, 'foo');

      const { body } = await expectMessage;

      expect(body.tags).to.have.property('ai.user.id', 'bar');
    });
  });

  describe('config', () => {
    const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

    let fakeAI;
    before(() => {
      fakeAI = new FakeApplicationInsights(connectionString);
    });
    after(() => {
      fakeAI.reset();
    });

    it('is passed to telemetry client, e.g. config.maxBatchSize = 3', async () => {
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

      expect(msgs).to.have.length(3);
    });
  });
});
