import { Writable, Transform, promises } from 'node:stream';
import * as applicationinsights from 'applicationinsights';
import abstractTransport from 'pino-abstract-transport';
import { trace as otelTrace, context as otelContext } from '@opentelemetry/api';

import { applyClientConfig } from './client-compat.js';

const { TelemetryClient } = applicationinsights;

const SeverityLevel = applicationinsights.Contracts?.SeverityLevel ?? /** @type {any} */ (applicationinsights).KnownSeverityLevel;

/**
 * Telemetry exception
 * @extends {Error}
 */
export class Exception extends Error {
  /** @type {string | undefined} */
  code = undefined;
  /**
   * @param {import('pino').SerializedError} serializedError
   */
  constructor(serializedError) {
    const { message, type, code, stack } = serializedError;
    super(message);

    this.name = type;
    this.type = type;
    this.code = code;
    this.stack = stack;
  }
}

/**
 * Transform pino log record to Application Insights Telemetry
 *
 * logstream -> transform-to-telemetry -> application insights
 *
 * @extends {Transform}
 */
export class TelemetryTransformation extends Transform {
  /** Log line key names to ignore when extracting properties */
  ignoreKeys = ['hostname', 'pid', 'level', 'time', 'msg'];
  /**
   * @constructor
   * @param {import('stream').TransformOptions} [options] - optional stream options
   * @param {import('../types/interfaces.js').TelemetryTransformationConfig} [config] - optional transform options
   */
  constructor(options, config) {
    super({ ...options, objectMode: true });
    this.ignoreKeys = config?.ignoreKeys || this.ignoreKeys;
  }
  /**
   *
   * @param {string | object} chunk
   * @param {string} _encoding
   * @param {CallableFunction} callback
   */
  _transform(chunk, _encoding, callback) {
    const telemetry = this.convertToTelemetry(chunk);
    callback(null, telemetry);
  }
  /**
   * Convert to telemetryish object
   * @param {string | object} chunk
   * @returns {import('../types/interfaces.js').LogTelemetry}
   */
  convertToTelemetry(chunk) {
    const line = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;

    const severity = this.convertLevel(line.level);

    return {
      time: new Date(line.time),
      msg: line.msg,
      severity,
      properties: this.extractProperties(line, this.ignoreKeys),
      ...(line.tagOverrides && { tagOverrides: line.tagOverrides }),
      ...(line.tracing && { tracing: line.tracing }),
      ...(line.err && { exception: new Exception(line.err) }),
    };
  }
  /**
   * Convert pino log level to numeric Application Insights severity (wire format).
   * @param {number} level
   * @returns {number}
   */
  convertLevel(level) {
    switch (level) {
      case 30:
        return SeverityLevel.Information;
      case 40:
        return SeverityLevel.Warning;
      case 50:
        return SeverityLevel.Error;
      case 60:
        return SeverityLevel.Critical;
      default:
        return SeverityLevel.Verbose;
    }
  }
  /**
   * Extract properties from log line
   * @param {any} line
   * @param {string[]} [ignoreKeys]
   * @returns {any}
   */
  extractProperties(line, ignoreKeys) {
    /** @type {Record<string, any>} */
    const properties = {};
    for (const [k, v] of Object.entries(line)) {
      if (ignoreKeys?.includes(k) || k === 'tagOverrides' || k === 'tracing') continue;
      properties[k] = v;
    }
    return properties;
  }
}

/**
 * Compose Application Insights pino transport
 * @param {import('../types/interfaces.js').ConnectionStringComposeConfig | import('../types/interfaces.js').DestinationComposeConfig} opts - transport options
 * @param {typeof TelemetryTransformation} [Transformation] - optional Telemetry transformation stream
 * @returns {ReturnType<typeof import('pino-abstract-transport')>}
 */
export default function compose(opts, Transformation = TelemetryTransformation) {
  const track = opts.track ?? trackTraceAndException;
  if (!opts.destination && (typeof track !== 'function' || !opts.connectionString)) {
    throw new TypeError('track function and connectionString are required');
  }

  /** @type {Writable | Transform} */
  let destination;
  if (opts.destination) {
    if (typeof opts.destination.write !== 'function') throw new TypeError('destination must be a writable stream');
    destination = opts.destination;
  } else {
    const client = new TelemetryClient(opts.connectionString);

    applyClientConfig(client, opts.config);

    const trackTelemetry = track.bind(client);
    destination = new Writable({
      objectMode: true,
      autoDestroy: true,
      write(chunk, _encoding, callback) {
        trackTelemetry(chunk);
        callback();
      },
    });
  }

  const transformToTelemetry = new Transformation({ objectMode: true, autoDestroy: true }, { ignoreKeys: opts.ignoreKeys });

  return abstractTransport((source) => {
    return promises.pipeline(source, transformToTelemetry, destination);
  });
}

/**
 * Default track function
 *
 * Tracks trace and occasional exception
 * @param {import('../types/interfaces.js').LogTelemetry} chunk
 * @this {import('applicationinsights').TelemetryClient}
 */
export function trackTraceAndException(chunk) {
  const { time, severity, msg: message, properties, tagOverrides, tracing, exception } = chunk;
  const effectiveTagOverrides = mergeTracingTagOverrides(this, tracing, tagOverrides);
  applyTracing(tracing, () => {
    this.trackTrace({ time, severity, message, properties, tagOverrides: effectiveTagOverrides });
    if (exception) this.trackException({ time, severity, exception, tagOverrides: effectiveTagOverrides });
  });
}

/**
 * @param {import('applicationinsights').TelemetryClient} client
 * @param {import('../types/interfaces.js').Tracing | undefined} tracing
 * @param {Record<string, string> | undefined} tagOverrides
 * @returns {Record<string, string> | undefined}
 */
function mergeTracingTagOverrides(client, tracing, tagOverrides) {
  if (!tracing) return tagOverrides;
  const keys = client?.context?.keys;
  if (!keys) return tagOverrides;
  return { [keys.operationId]: tracing.traceId, [keys.operationParentId]: tracing.spanId, ...tagOverrides };
}

/**
 * Run `fn` inside an OpenTelemetry context derived from `tracing`
 * @template T
 * @param {import('../types/interfaces.js').Tracing | undefined} tracing
 * @param {() => T} fn
 * @returns {T}
 */
export function applyTracing(tracing, fn) {
  if (!tracing) return fn();
  /** @type {import('@opentelemetry/api').SpanContext} */
  // @ts-ignore
  const spanContext = {
    traceId: tracing.traceId,
    spanId: tracing.spanId,
    traceFlags: tracing.traceFlags ?? 1,
    isRemote: true,
    ...(tracing.traceState && { traceState: tracing.traceState }),
  };
  const ctx = otelTrace.setSpanContext(otelContext.active(), spanContext);
  return otelContext.with(ctx, fn);
}
