declare module '@0dep/pino-applicationinsights' {
	import type { Transform } from 'node:stream';
	import type { Writable, Transform as Transform_1 } from 'stream';
	import type { TelemetryClient, Contracts } from 'applicationinsights';
	import type { default as build } from 'pino-abstract-transport';
	/// <reference types="node" />
	/**
	 * Application Insights pino transport
	 * @param opts - transport options
	 * @param Transformation - optional Telemetry transformation stream
	 * */
	export default function compose(opts: ConnectionStringBuildConfig | DestinationBuildConfig, Transformation?: typeof TelemetryTransformation | undefined): buildReturn;
	/**
	 * Telemetry exception
	 * 
	 */
	export class Exception extends Error {
		
		constructor(serializedError: import('pino').SerializedError);
		
		code: string | undefined;
		type: string;
		stack: string;
	}
	/**
	 * Transform pino log record to Application Insights Telemetry
	 *
	 * logstream -> transform-to-telemetry -> application insights
	 *
	 * 
	 */
	export class TelemetryTransformation extends Transform {
		/**
		 * @param options - optional stream options
		 * @param config - optional transform options
		 */
		constructor(options?: import("stream").TransformOptions | undefined, config?: TelemetryTransformationConfig | undefined);
		/** Log line key names to ignore when extracting properties */
		ignoreKeys: string[];
		
		_transform(chunk: string | object, _encoding: string, callback: CallableFunction): void;
		/**
		 * Convert to telemetryish object
		 * */
		convertToTelemetry(chunk: string | object): LogTelemetry;
		/**
		 * Convert pino log level to SeverityLevel
		 * */
		convertLevel(level: number): import('applicationinsights').Contracts.SeverityLevel;
		/**
		 * Extract properties from log line
		 * */
		extractProperties(line: any, ignoreKeys?: string[] | undefined): any;
	}
  type buildReturn = build.OnUnknown & Transform_1;
  type trackFunction = (this: TelemetryClient, chunk: LogTelemetry) => void;

  interface TelemetryTransformationConfig {
	/**
	 * pino ignore keys, filters Telemetry properties
	 * @default {string[]} hostname pid, level, time, msg
	 */
	ignoreKeys?: string[];
  }

  interface BuildConfig extends TelemetryTransformationConfig {
	[k: string]: any,
  }

  /**
   * Pino to application insigths transport build config with connection string
   */
  interface ConnectionStringBuildConfig extends BuildConfig {
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
  interface DestinationBuildConfig extends BuildConfig {
	/** Destination stream */
	destination: Writable;
  }

  interface LogTelemetry extends Contracts.Telemetry {
	severity: Contracts.SeverityLevel;
	msg: string;
	exception?: Error;
	[k: string]: any;
  }
}

declare module '@0dep/pino-applicationinsights/fake-applicationinsights' {
	import type { TelemetryClient } from 'applicationinsights';
	import type { default as nock } from 'nock';
	/**
	 * Intercept all calls to application insights
	 */
	export class FakeApplicationInsights {
		/**
		 * @param setupString - Fake application insights connection string
		 */
		constructor(setupString?: string | undefined);
		client: TelemetryClient;
		_endpointURL: URL;
		_endpointPathname: string;
		_scope: nock.Scope;
		/**
		 * Expect tracked message
		 * */
		expectMessageData(): Promise<FakeCollectData>;
		/**
		 * Expect tracked event
		 * */
		expectEventData(): Promise<FakeCollectData>;
		/**
		 * Expect tracked exception
		 * */
		expectExceptionData(): Promise<FakeCollectData>;
		/**
		 * Expect tracked telemetry type
		 * @param telemetryType Telemetry type
		 * */
		expectEventType(telemetryType: string): Promise<FakeCollectData>;
		/**
		 * Expect tracked telemetrys
		 * @param count wait for at least tracked telemetrys before returning
		 * */
		expect(count?: number | undefined): Promise<FakeCollectData[]>;
		/**
		 * Parse multiline JSON
		 * */
		parseLines(deflatedBody: string): any[];
		/**
		 * Deflate
		 * @param body gzipped body
		 * */
		deflateSync(body: any): string;
		/**
		 * Reset expected faked Application Insights calls
		 *
		 * Calls nock clean all
		 * */
		reset(): void;
	}
  interface FakeCollectBody {
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

  interface FakeCollectData {
	uri: string;
	method: string;
	headers: Record<string, any>;
	body: FakeCollectBody;
  }
}

//# sourceMappingURL=index.d.ts.map