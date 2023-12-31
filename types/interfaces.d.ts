/// <reference types="node" />

import { Writable } from 'stream'
import { TelemetryClient, Contracts } from 'applicationinsights'

export type trackFunction = (this: TelemetryClient, chunk: LogTelemetry) => void;

export interface TelemetryTransformationConfig {
  /**
   * pino ignore keys, filters Telemetry properties
   * @default {string[]} hostname pid, level, time, msg
   */
  ignoreKeys?: string[];
}

export interface ComposeConfig extends TelemetryTransformationConfig {
  [k: string]: any,
}

/**
 * Pino to application insights transport compose config with connection string
 */
export interface ConnectionStringComposeConfig extends ComposeConfig {
  /** Application insights connection string */
  connectionString: string;
  /**
   * track function called with Telemetry client context
   * @example
   * this.trackTrace({ time: chunk.time, message: chunk.msg });
   */
  track?: (this: TelemetryClient, chunk: LogTelemetry) => void;
  /**
   * optional Telemetry client config
   */
  config?: Partial<TelemetryClient['config']>;
}

/**
 * Pino to application insights transport compose config with destination stream
 */
export interface DestinationComposeConfig extends ComposeConfig {
  /** Destination stream */
  destination: Writable;
}

export interface LogTelemetry extends Contracts.Telemetry {
  severity: Contracts.SeverityLevel;
  /** Pino log message */
  msg: string;
  /** Telemetry properties */
  properties: Record<string, any>;
  exception?: Error;
  [k: string]: any;
}

declare interface FakeCollectBody {
  ver: number;
  sampleRate: number;
  tags: Record<string, string>;
  data: {
    baseType: string;
    baseData: {
      ver: number;
      properties: Record<string, any>;
      message?: string
      severityLevel?: number
      [x: string]: any;
    },
  };
  iKey: string;
  name: string;
  time: string;
}

export interface FakeCollectData {
  /** request uri */
  uri: string;
  /** request method */
  method: string;
  headers: Record<string, any>;
  body: FakeCollectBody;
}
