import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { Contracts } from 'applicationinsights';

import build from '../../src/index.js';
import { FakeApplicationInsights } from '../../src/fake-applicationinsights.js';

const filePath = fileURLToPath(import.meta.url);

describe('log transport', () => {
  const connectionString = `InstrumentationKey=${randomUUID()};IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/`;

  let logger, transport, fakeAI;
  before(() => {
    fakeAI = new FakeApplicationInsights(connectionString);

    transport = build({
      track(chunk) {
        const { time, severity, msg: message, properties, exception } = chunk;
        this.trackTrace({ time, severity, message, properties });
        if (exception) this.trackException({ time, exception, severity });
      },
      connectionString,
      config: { maxBatchSize: 1 },
    });

    logger = pino({ level: 'trace' }, transport);
  });
  after(() => {
    transport.destroy();
    fakeAI.reset();
  });

  it('logs debug', async () => {
    const expectMessage = fakeAI.expectMessageData();

    logger.debug({ bar: 'baz' }, 'foo');

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.deep.include({ severityLevel: Contracts.SeverityLevel.Verbose, message: 'foo' });
  });

  it('logs info', async () => {
    const expectMessage = fakeAI.expectMessageData();

    logger.info({ bar: 'baz' }, 'foo');

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.deep.include({ severityLevel: Contracts.SeverityLevel.Information, message: 'foo' });
  });

  it('logs warn', async () => {
    const expectMessage = fakeAI.expectMessageData();

    logger.warn({ bar: 'baz' }, 'foo');

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.deep.include({ severityLevel: Contracts.SeverityLevel.Warning, message: 'foo' });
  });

  it('logs error', async () => {
    const expectMessage = fakeAI.expectMessageData();
    const expectException = fakeAI.expectExceptionData();

    logger.error(new Error('bar'), 'foo');

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.deep.include({ severityLevel: Contracts.SeverityLevel.Error, message: 'foo' });

    const err = await expectException;

    expect(err.body.data.baseData).to.have.property('severityLevel', Contracts.SeverityLevel.Error);
    expect(err.body.data.baseData).to.have.property('exceptions').with.length(1);
    expect(err.body.data.baseData.exceptions[0]).to.deep.include({
      hasFullStack: true,
      message: 'bar',
    });
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

    const [ exception ] = err.body.data.baseData.exceptions;

    expect(exception).to.deep.include({
      typeName: 'TypeError',
      hasFullStack: true,
      message: 'bar',
    });

    expect(exception).to.have.property('parsedStack').with.property('length').that.is.above(0);

    expect(exception.parsedStack[0].fileName, 'stack file name').to.include(filePath);
  });

  it('logs fatal', async () => {
    const expectMessage = fakeAI.expectMessageData();
    const expectException = fakeAI.expectExceptionData();

    logger.fatal(new Error('bar'), 'foo');

    const msg = await expectMessage;

    expect(msg.body.data.baseData).to.deep.include({ severityLevel: Contracts.SeverityLevel.Critical, message: 'foo' });

    const err = await expectException;

    expect(err.body.data.baseData).to.have.property('severityLevel', Contracts.SeverityLevel.Critical);
    expect(err.body.data.baseData).to.have.property('exceptions').with.length(1);

    const [ exception ] = err.body.data.baseData.exceptions;

    expect(exception).to.deep.include({
      typeName: 'Error',
      hasFullStack: true,
      message: 'bar',
    });

    expect(exception).to.have.property('parsedStack').with.property('length').that.is.above(0);

    expect(exception.parsedStack[0].fileName, 'stack file name').to.include(filePath);
  });
});
