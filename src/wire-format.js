import zlib from 'node:zlib';

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
    return zlib.gunzipSync(Buffer.from(hex, 'hex')).toString();
  } catch {
    return undefined;
  }
}
