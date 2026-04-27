import zlib from 'node:zlib';
import { extractTelemetryItems } from '../../src/wire-format.js';

describe('extractTelemetryItems (FakeApplicationInsights body decoder)', () => {
  it('decodes the v2 wire format (gzipped NDJSON, hex-encoded by nock)', () => {
    const ndjson = [
      '{"data":{"baseType":"MessageData","baseData":{"message":"a"}}}',
      '{"data":{"baseType":"MessageData","baseData":{"message":"b"}}}',
    ].join('\n');
    const hex = zlib.gzipSync(Buffer.from(ndjson)).toString('hex');

    const items = extractTelemetryItems(hex);

    expect(items).to.have.length(2);
    expect(items[0].data.baseType).to.equal('MessageData');
    expect(items[1].data.baseData.message).to.equal('b');
  });

  it('decodes the v3 wire format (an array of TelemetryItem objects pre-parsed by nock from application/json)', () => {
    const items = extractTelemetryItems([
      { data: { baseType: 'MessageData', baseData: { message: 'a' } } },
      { data: { baseType: 'EventData', baseData: { name: 'b' } } },
    ]);

    expect(items).to.have.length(2);
    expect(items[1].data.baseType).to.equal('EventData');
  });

  it('decodes a v3 wire format where nock hands us a plain JSON-array string', () => {
    const stringified = JSON.stringify([{ data: { baseType: 'MessageData', baseData: { message: 'a' } } }]);
    const items = extractTelemetryItems(stringified);
    expect(items).to.have.length(1);
    expect(items[0].data.baseType).to.equal('MessageData');
  });

  it('decodes a single TelemetryItem object', () => {
    const items = extractTelemetryItems({ data: { baseType: 'MessageData', baseData: { message: 'a' } } });
    expect(items).to.have.length(1);
    expect(items[0].data.baseType).to.equal('MessageData');
  });

  it('returns an empty array for null', () => {
    expect(extractTelemetryItems(null)).to.deep.equal([]);
  });

  it('returns an empty array for undefined', () => {
    expect(extractTelemetryItems(undefined)).to.deep.equal([]);
  });

  it('returns an empty array for a non-string non-object value', () => {
    expect(extractTelemetryItems(42)).to.deep.equal([]);
    expect(extractTelemetryItems(true)).to.deep.equal([]);
  });

  it('treats a non-hex string as plain NDJSON (tryGunzipHex rejects on the regex check)', () => {
    const ndjson = '{"data":{"baseType":"MessageData","baseData":{"message":"plain"}}}';
    const items = extractTelemetryItems(ndjson);
    expect(items).to.have.length(1);
    expect(items[0].data.baseData.message).to.equal('plain');
  });

  it('treats a too-short hex string as plain NDJSON', () => {
    expect(() => extractTelemetryItems('ab')).to.throw(SyntaxError);
  });

  it('does not attempt gunzip when a hex string lacks the gzip magic header', () => {
    const hexWithoutMagic = Buffer.from('{"plain":1}').toString('hex');
    expect(() => extractTelemetryItems(hexWithoutMagic)).to.throw(SyntaxError);
  });

  it('falls back to NDJSON parsing when a hex body has the gzip magic but corrupt payload', () => {
    let err;
    try {
      extractTelemetryItems('1f8b00112233');
    } catch (e) {
      err = e;
    }
    expect(err).to.be.an.instanceOf(SyntaxError);
  });
});
