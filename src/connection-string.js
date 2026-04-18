export const DEFAULT_INGESTION_ENDPOINT = 'https://dc.services.visualstudio.com';

export const INGESTION_PATHNAME = '/v2.1/track';

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

  const ingestionEndpoint = (parts.ingestionendpoint || DEFAULT_INGESTION_ENDPOINT).replace(/\/+$/, '');
  return { instrumentationKey: parts.instrumentationkey, ingestionEndpoint };
}
