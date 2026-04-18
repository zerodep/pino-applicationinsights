import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { TelemetryClient as V3TelemetryClient } from 'applicationinsights-v3';

import compose, { TelemetryTransformation } from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';
import { applyClientConfig } from '../../src/client-compat.js';

describe('applicationinsights v3 (live shim)', () => {
  const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

  it('v3 TelemetryClient.getStatsbeat() returns null', () => {
    const client = new V3TelemetryClient(connectionString);
    expect(client.getStatsbeat()).to.equal(null);
  });

  it('applyClientConfig is a no-op when v3 returns null from getStatsbeat', () => {
    const client = new V3TelemetryClient(connectionString);
    expect(() => applyClientConfig(client, { disableStatsbeat: true })).to.not.throw();
  });

  it('FakeApplicationInsights intercepts a v3 trackTrace call', async () => {
    const fakeAI = new FakeApplicationInsights(connectionString);
    try {
      const transformation = new TelemetryTransformation();
      const v3Client = new V3TelemetryClient(connectionString);

      const expectMessage = fakeAI.expectMessageData();

      const telemetry = transformation.convertToTelemetry({
        level: 30,
        time: Date.now(),
        msg: 'hello-from-v3',
        bar: 'baz',
      });

      v3Client.trackTrace({
        time: telemetry.time,
        severity: telemetry.severity,
        message: telemetry.msg,
        properties: telemetry.properties,
      });
      await v3Client.flush();

      const msg = await expectMessage;
      expect(msg.body.data.baseData).to.deep.include({ message: 'hello-from-v3' });
      expect(msg.body.data.baseData.properties).to.deep.include({ bar: 'baz' });
    } finally {
      fakeAI.reset();
    }
  });

  it('compose() pipeline drives a v3 client via opts.destination', async () => {
    const fakeAI = new FakeApplicationInsights(connectionString);
    try {
      const v3Client = new V3TelemetryClient(connectionString);

      const expectMessage = fakeAI.expectMessageData();

      const { Writable } = await import('node:stream');
      const destination = new Writable({
        objectMode: true,
        autoDestroy: true,
        write(chunk, _enc, cb) {
          v3Client.trackTrace({ time: chunk.time, severity: chunk.severity, message: chunk.msg, properties: chunk.properties });
          cb();
        },
      });

      const transport = compose({ destination });
      const logger = pino(transport);

      logger.info({ kind: 'v3' }, 'hello');
      await new Promise((r) => setImmediate(r));
      await v3Client.flush();

      const msg = await expectMessage;
      expect(msg.body.data.baseData).to.have.property('message', 'hello');
      expect(msg.body.data.baseData.properties).to.deep.include({ kind: 'v3' });

      transport.destroy();
    } finally {
      fakeAI.reset();
    }
  });
});
