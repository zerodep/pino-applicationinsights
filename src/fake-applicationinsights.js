import zlib from 'node:zlib';
import { TelemetryClient } from 'applicationinsights';
import nock from 'nock';

class CollectData {
  /**
   * @param {string} uri
   * @param {string} method
   * @param {Record<string, any>} headers
   * @param {any} body
   */
  constructor(uri, method, headers, body) {
    this.uri = uri;
    this.method = method;
    this.body = body;
    this.headers = headers;
  }
}

/**
 * Intercept all calls to application insights
 */
export class FakeApplicationInsights {
  /**
   * @param {string} [setupString] - Fake application insights connection string
   */
  constructor(setupString) {
    const client = this.client = new TelemetryClient(setupString);
    client.getStatsbeat().enable(false);

    const endpointURL = this._endpointURL = new URL(client.config.endpointUrl);

    this._endpointPathname = endpointURL.pathname;
    this._scope = nock(endpointURL.origin, {
      reqheaders: {
        'content-type': 'application/x-json-stream',
        'content-encoding': 'gzip',
      },
    });
  }
  /**
   * Expect tracked message
   * @returns {Promise<import('../types/interfaces.js').FakeCollectData>}
   */
  expectMessageData() {
    return this.expectTelemetryType('MessageData');
  }
  /**
   * Expect tracked event
   * @returns {Promise<import('../types/interfaces.js').FakeCollectData>}
   */
  expectEventData() {
    return this.expectTelemetryType('EventData');
  }
  /**
   * Expect tracked exception
   * @returns {Promise<import('../types/interfaces.js').FakeCollectData>}
   */
  expectExceptionData() {
    return this.expectTelemetryType('ExceptionData');
  }
  /**
   * Expect tracked telemetry type
   * @param {import('applicationinsights').Contracts.TelemetryTypeValues} telemetryType Telemetry type
   * @returns {Promise<import('../types/interfaces.js').FakeCollectData>}
   */
  expectTelemetryType(telemetryType) {
    return new Promise((resolve) => {
      /** @type {any} */
      let tracked;
      this._scope
        .post(this._endpointPathname, (body) => {
          const deflated = this.parseLines(this.deflateSync(body));
          tracked = deflated.find((l) => l.data.baseType === telemetryType);
          return !!tracked;
        })
        .reply(function reply(uri) {
          resolve(new CollectData(this.req.method, uri, this.req.headers, tracked));
          return [ 200 ];
        });
    });
  }
  /**
   * Expect tracked telemetrys
   * @param {number} [count] wait for at least tracked telemetrys before returning, default is 1
   * @returns {Promise<import('../types/interfaces.js').FakeCollectData[]>}
   */
  expect(count = 1) {
    return new Promise((resolve) => {
      /** @type {any[]} */
      let collected = [];
      let deflated;

      this._scope
        .post(this._endpointPathname, (body) => {
          const match = collected.length <= count;
          if (!match) return false;

          deflated = this.deflateSync(body);
          collected = collected.concat(this.parseLines(deflated));

          return true;
        })
        .times(count)
        .reply(function reply(uri) {
          if (collected.length >= count) {
            resolve(collected.map((l) => new CollectData(this.req.method, uri, this.req.headers, l)));
          }
          return [ 200 ];
        });
    });
  }
  /**
   * Parse multiline JSON
   * @param {string} deflatedBody
   * @returns {any[]}
   */
  parseLines(deflatedBody) {
    const lines = [];
    for (const line of deflatedBody.split(/\r?\n/)) lines.push(JSON.parse(line));
    return lines;
  }
  /**
   * Deflate
   * @param {any} body gzipped body
   * @returns {string}
   */
  deflateSync(body) {
    return zlib.gunzipSync(Buffer.from(body, 'hex')).toString();
  }
  /**
   * Reset expected faked Application Insights calls
   *
   * Calls nock clean all
   * @returns {void}
   */
  reset() {
    nock.cleanAll();
  }
}
