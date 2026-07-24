import { gunzipSync } from 'node:zlib';

import { TelemetryClient } from 'applicationinsights';
import nock from 'nock';

const DEFAULT_INGESTION_ENDPOINT = 'https://dc.services.visualstudio.com';

const INGESTION_PATHNAME = '/v2.1/track';

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
 * Intercept calls to application insights.
 */
export class FakeApplicationInsights {
  /**
   * @param {string} setupString - Fake application insights connection string
   */
  constructor(setupString) {
    const { ingestionEndpoint } = parseConnectionString(setupString);

    const endpointURL = (this._endpointURL = new URL(INGESTION_PATHNAME, ingestionEndpoint));
    this._endpointPathname = endpointURL.pathname;

    this.client = new TelemetryClient(setupString);

    this._scope = nock(endpointURL.origin);
    /** @type {Array<{ kind: 'type', type: string, resolve: (data: CollectData) => void } | { kind: 'count', count: number, collected: CollectData[], resolve: (data: CollectData[]) => void }>} */
    this._pending = [];
    /** @type {import('nock').Interceptor[]} */
    this._interceptors = [];
  }
  _installDispatcher() {
    if (this._interceptors.length > 0) return;
    const pending = this._pending;
    const dispatcher = this._scope.persist().post(
      this._endpointPathname,
      /** @this {{ method: string, path: string, headers: Record<string, any> }} */ function dispatch(body) {
        if (pending.length === 0) return false;

        const items = extractTelemetryItems(body).filter((item) => item && item.data);
        if (items.length === 0) return false;

        const req = this;
        const collected = items.map((item) => new CollectData(req.method, req.path, req.headers, item));

        let consumed = false;

        const claimed = new Set();
        for (let itemIdx = 0; itemIdx < collected.length; itemIdx++) {
          for (let i = 0; i < pending.length; i++) {
            const p = pending[i];
            if (p.kind !== 'type' || p.type !== items[itemIdx].data.baseType || claimed.has(itemIdx)) continue;
            pending.splice(i, 1);
            claimed.add(itemIdx);
            p.resolve(collected[itemIdx]);
            consumed = true;
            break;
          }
        }

        for (let i = pending.length - 1; i >= 0; i--) {
          const p = pending[i];
          if (p.kind !== 'count') continue;
          for (const c of collected) p.collected.push(c);
          consumed = true;
          if (p.collected.length >= p.count) {
            pending.splice(i, 1);
            p.resolve(p.collected);
          }
        }

        return consumed;
      },
    );
    dispatcher.reply(() => [200, { itemsReceived: 1, itemsAccepted: 1, errors: [] }]);
    this._interceptors.push(dispatcher);

    const fallback = this._scope.persist().post(this._endpointPathname, () => true);
    fallback.reply((_uri, body) => {
      const items = extractTelemetryItems(body).filter((item) => item && item.data);
      const total = items.length || 1;
      return [200, { itemsReceived: total, itemsAccepted: total, errors: [] }];
    });
    this._interceptors.push(fallback);
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
    this._installDispatcher();
    return new Promise((resolve) => {
      this._pending.push({ kind: 'type', type: telemetryType, resolve });
    });
  }
  /**
   * Expect tracked telemetrys
   * @param {number} [count] wait for at least tracked telemetrys before returning, default is 1
   * @returns {Promise<import('../types/interfaces.js').FakeCollectData[]>}
   */
  expect(count = 1) {
    this._installDispatcher();
    return new Promise((resolve) => {
      this._pending.push({ kind: 'count', count, collected: [], resolve });
    });
  }
  /**
   * Reset expected faked Application Insights calls.
   * @returns {void}
   */
  reset() {
    this._pending.length = 0;
    for (const interceptor of this._interceptors) nock.removeInterceptor(interceptor);
    this._interceptors.length = 0;
  }
}

/**
 * Parse an Application Insights connection string into its component parts.
 * @param {string} input
 * @returns {{ instrumentationKey: string, ingestionEndpoint: string }}
 */
export function parseConnectionString(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError('connectionString must be a non-empty string');
  }

  if (!input.includes('=')) {
    return { instrumentationKey: input, ingestionEndpoint: DEFAULT_INGESTION_ENDPOINT };
  }

  /** @type {Record<string, string>} */
  const parts = {};
  for (const segment of input.split(';')) {
    if (!segment) continue;
    const eq = segment.indexOf('=');
    if (eq <= 0) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    const value = segment.slice(eq + 1).trim();
    parts[key] = value;
  }

  const ingestionEndpoint = (parts.ingestionendpoint ?? DEFAULT_INGESTION_ENDPOINT).replace(/\/+$/, '');
  return { instrumentationKey: parts.instrumentationkey, ingestionEndpoint };
}

/**
 * Decode an Application Insights ingestion request body into TelemetryItem objects.
 * @param {unknown} body - Body received by the nock matcher.
 * @returns {any[]} TelemetryItem-shaped objects (each has `.data.baseType`).
 */
export function extractTelemetryItems(body) {
  /** @type {unknown} */
  let payload = body;

  if (typeof payload === 'string') {
    const gunzipped = tryGunzipHex(payload);
    if (gunzipped !== undefined) payload = gunzipped;
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.startsWith('[')) return JSON.parse(trimmed);
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') return [payload];
  return [];
}

/**
 * @param {string} hex
 * @returns {string | undefined}
 */
function tryGunzipHex(hex) {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length < 4) return undefined;
  if (hex.slice(0, 4).toLowerCase() !== '1f8b') return undefined;
  try {
    return gunzipSync(Buffer.from(hex, 'hex')).toString();
  } catch {
    return undefined;
  }
}
