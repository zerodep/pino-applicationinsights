import { Writable, pipeline } from 'node:stream';
import abstractTransport from 'pino-abstract-transport';
import { pino } from 'pino';
import { Contracts } from 'applicationinsights';
import * as ck from 'chronokinesis';

import { TelemetryTransformation } from '../../src/index.js';

describe('TelemetryTransformation', () => {
  afterEach(ck.reset);

  it('transform string to object and writes to destination', () => {
    ck.freeze();
    const msgs = [];
    const destination = new Writable({
      autoDestroy: true,
      objectMode: true,
      write(chunk, _encoding, callback) {
        msgs.push(chunk);
        callback();
      },
    });

    const transport = abstractTransport((source) => {
      pipeline(source, new TelemetryTransformation(), destination, () => {});
    }, { parse: 'lines' });

    const logger = pino(transport);

    logger.info({ bar: 'baz' }, 'foo');

    expect(msgs[0]).to.deep.equal({
      msg: 'foo',
      severity: Contracts.SeverityLevel.Information,
      properties: { bar: 'baz' },
      time: new Date(),
    });
  });
});
