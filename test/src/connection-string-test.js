import { parseConnectionString } from '@0dep/pino-applicationinsights/fake-applicationinsights';

describe('parseConnectionString', () => {
  it('parses an instrumentation key and ingestion endpoint', () => {
    const parsed = parseConnectionString(
      'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://ingestion.local;LiveEndpoint=https://livemonitor.local/',
    );
    expect(parsed).to.deep.equal({
      instrumentationKey: '00000000-0000-0000-0000-000000000001',
      ingestionEndpoint: 'https://ingestion.local',
    });
  });

  it('treats a bare string with no key=value pairs as an instrumentation key and uses the default ingestion endpoint', () => {
    const parsed = parseConnectionString('00000000-0000-0000-0000-000000000002');
    expect(parsed).to.deep.equal({
      instrumentationKey: '00000000-0000-0000-0000-000000000002',
      ingestionEndpoint: 'https://dc.services.visualstudio.com',
    });
  });

  it('strips trailing slashes from ingestion endpoint', () => {
    const parsed = parseConnectionString('InstrumentationKey=k;IngestionEndpoint=https://eu-west.in.applicationinsights.azure.com/');
    expect(parsed.ingestionEndpoint).to.equal('https://eu-west.in.applicationinsights.azure.com');
  });

  it('is case insensitive for connection-string keys', () => {
    const parsed = parseConnectionString('instrumentationkey=k;ingestionendpoint=https://x.local');
    expect(parsed).to.deep.equal({ instrumentationKey: 'k', ingestionEndpoint: 'https://x.local' });
  });

  it('falls back to the default ingestion endpoint if only an InstrumentationKey is provided in connection-string form', () => {
    const parsed = parseConnectionString('InstrumentationKey=00000000-0000-0000-0000-000000000003');
    expect(parsed.ingestionEndpoint).to.equal('https://dc.services.visualstudio.com');
  });

  it('ignores empty segments produced by trailing or duplicate semicolons', () => {
    const parsed = parseConnectionString(';InstrumentationKey=k;;IngestionEndpoint=https://x.local;;');
    expect(parsed).to.deep.equal({ instrumentationKey: 'k', ingestionEndpoint: 'https://x.local' });
  });

  it('throws TypeError on a non-string input', () => {
    expect(() => parseConnectionString(undefined)).to.throw(TypeError);
    expect(() => parseConnectionString(null)).to.throw(TypeError);
    expect(() => parseConnectionString({})).to.throw(TypeError);
  });

  it('throws TypeError on an empty string', () => {
    expect(() => parseConnectionString('')).to.throw(TypeError);
  });

  it('skips a segment that contains no `=` separator', () => {
    const parsed = parseConnectionString('InstrumentationKey=k;noequalshere;IngestionEndpoint=https://x.local');
    expect(parsed).to.deep.equal({ instrumentationKey: 'k', ingestionEndpoint: 'https://x.local' });
  });

  it('skips a segment whose `=` is at index 0 (empty key)', () => {
    const parsed = parseConnectionString('InstrumentationKey=k;=valuewithoutkey;IngestionEndpoint=https://x.local');
    expect(parsed).to.deep.equal({ instrumentationKey: 'k', ingestionEndpoint: 'https://x.local' });
  });
});
