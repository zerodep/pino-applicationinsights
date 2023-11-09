import { Writable, Transform, promises } from 'node:stream';
import { Contracts, TelemetryClient } from 'applicationinsights';
import abstractTransport from 'pino-abstract-transport';

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
  ignoreKeys = [ 'hostname', 'pid', 'level', 'time', 'msg' ];
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
      ...(line.err && { exception: new Exception(line.err) }),
    };
  }
  /**
   * Convert pino log level to SeverityLevel
   * @param {number} level
   * @returns {import('applicationinsights').Contracts.SeverityLevel}
   */
  convertLevel(level) {
    switch (level) {
      case 30:
        return Contracts.SeverityLevel.Information;
      case 40:
        return Contracts.SeverityLevel.Warning;
      case 50:
        return Contracts.SeverityLevel.Error;
      case 60:
        return Contracts.SeverityLevel.Critical;
      default:
        return Contracts.SeverityLevel.Verbose;
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
    for (const [ k, v ] of Object.entries(line)) {
      if (ignoreKeys?.includes(k)) continue;
      properties[k] = v;
    }
    return properties;
  }
}

/**
 * Compose Application Insights pino transport
 * @param {import('../types/interfaces.js').ConnectionStringBuildConfig | import('../types/interfaces.js').DestinationBuildConfig} opts - transport options
 * @param {typeof TelemetryTransformation} [Transformation] - optional Telemetry transformation stream
 * @returns {ReturnType<typeof import('pino-abstract-transport')>}
 */
export default function compose(opts, Transformation = TelemetryTransformation) {
  if (!opts.destination && (!opts.track || !opts.connectionString)) {
    throw new TypeError('track function and connectionString are required');
  }

  /** @type {Writable | Transform} */
  let destination;
  let client;
  if (opts.destination) {
    if (typeof opts.destination.write !== 'function') throw new TypeError('destination must be a writable stream');
    destination = opts.destination;
  } else {
    client = new TelemetryClient(opts.connectionString);

    if (opts.config) {
      Object.assign(client.config, opts.config);
    }

    const track = opts.track.bind(client);
    destination = new Writable({
      objectMode: true,
      autoDestroy: true,
      write(chunk, _encoding, callback) {
        track(chunk);
        callback();
      },
    });
  }

  const transformToTelemetry = new Transformation({ objectMode: true, autoDestroy: true }, { ignoreKeys: opts.ignoreKeys });

  return abstractTransport((source) => {
    return promises.pipeline(source, transformToTelemetry, destination);
  });
}
