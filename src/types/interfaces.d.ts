/// <reference types="node" />

import { Writable, Transform } from 'stream'
import { TelemetryClient, Contracts } from 'applicationinsights'
import build from 'pino-abstract-transport'

export type buildReturn = build.OnUnknown & Transform;
export type trackFunction = (this: TelemetryClient, chunk: LogTelemetry) => void;

export interface TelemetryTransformationConfig {
  /**
   * pino ignore keys, filters Telemetry properties
   * @default {string[]} hostname pid, level, time, msg
   */
  ignoreKeys?: string[];
}

export interface BuildConfig extends TelemetryTransformationConfig {
  [k: string]: any,
}

/**
 * Pino to application insigths transport build config with connection string
 */
export interface ConnectionStringBuildConfig extends BuildConfig {
  /** track function called with Telemetry client context */
  track: trackFunction;
  /** Application insights connection string */
  connectionString: string;
  /**
   * optional Telemetry client config
   */
  config?: Partial<TelemetryClient['config']>;
}

/**
 * Pino to application insigths transport build config with destination stream
 */
export interface DestinationBuildConfig extends BuildConfig {
  /** Destination stream */
  destination: Writable;
}

export interface LogTelemetry extends Contracts.Telemetry {
  severity: Contracts.SeverityLevel;
  msg: string;
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
      [x: string]: any;
    },
  };
  iKey: string;
  name: string;
  time: string;
}

export interface FakeCollectData {
  uri: string;
  method: string;
  headers: Record<string, any>;
  body: FakeCollectBody;
}
