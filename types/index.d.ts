declare module '@0dep/pino-applicationinsights' {
	import type { Transform } from 'node:stream';
	import type { Writable } from 'stream';
	import type { TelemetryClient, Contracts } from 'applicationinsights';
	import * as applicationinsights from 'applicationinsights';
	/**
	 * Compose Application Insights pino transport
	 * @param opts - transport options
	 * @param Transformation - optional Telemetry transformation stream
	 * */
	export default function compose(opts: ConnectionStringComposeConfig | DestinationComposeConfig, Transformation?: typeof TelemetryTransformation): ReturnType<typeof import("pino-abstract-transport")>;
	/**
	 * Default track function
	 *
	 * Tracks trace and occasional exception
	 * */
	export function trackTraceAndException(this:TelemetryClient, chunk: LogTelemetry): void;
	/**
	 * Telemetry exception
	 * 
	 */
	export class Exception extends Error {
		
		constructor(serializedError: import("pino").SerializedError);
		
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
		constructor(options?: import("stream").TransformOptions, config?: TelemetryTransformationConfig);
		/** Log line key names to ignore when extracting properties */
		ignoreKeys: string[];
		
		_transform(chunk: string | object, _encoding: string, callback: CallableFunction): void;
		/**
		 * Convert to telemetryish object
		 * */
		convertToTelemetry(chunk: string | object): LogTelemetry;
		/**
		 * Convert pino log level to numeric Application Insights severity (wire format).
		 * */
		convertLevel(level: number): number;
		/**
		 * Extract properties from log line
		 * */
		extractProperties(line: any, ignoreKeys?: string[]): any;
	}
  interface TelemetryTransformationConfig {
	/**
	 * pino ignore keys, filters Telemetry properties
	 * @default {string[]} hostname pid, level, time, msg
	 */
	ignoreKeys?: string[];
  }

  interface ComposeConfig extends TelemetryTransformationConfig {
	[k: string]: any;
  }

  /**
   * Pino to application insights transport compose config with connection string
   */
  interface ConnectionStringComposeConfig extends ComposeConfig {
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
  interface DestinationComposeConfig extends ComposeConfig {
	/** Destination stream */
	destination: Writable;
  }

  interface LogTelemetry extends Contracts.Telemetry {
	severity: Contracts.SeverityLevel;
	/** Pino log message */
	msg: string;
	/** Telemetry properties */
	properties: Record<string, any>;
	exception?: Error;
	[k: string]: any;
  }

	export {};
}

declare module '@0dep/pino-applicationinsights/fake-applicationinsights' {
	import type { TelemetryClient } from 'applicationinsights';
	import type { default as nock } from 'nock';
	/**
	 * Intercept calls to application insights.
	 */
	export class FakeApplicationInsights {
		/**
		 * @param setupString - Fake application insights connection string
		 */
		constructor(setupString: string);
		_endpointURL: URL;
		_endpointPathname: string;
		client: TelemetryClient;
		_scope: nock.Scope;
		
		_pending: Array<{
			kind: "type";
			type: string;
			resolve: (data: CollectData) => void;
		} | {
			kind: "count";
			count: number;
			collected: CollectData[];
			resolve: (data: CollectData[]) => void;
		}>;
		
		_interceptors: import("nock").Interceptor[];
		_installDispatcher(): void;
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
		expectTelemetryType(telemetryType: import("applicationinsights").Contracts.TelemetryTypeValues): Promise<FakeCollectData>;
		/**
		 * Expect tracked telemetrys
		 * @param count wait for at least tracked telemetrys before returning, default is 1
		 * */
		expect(count?: number): Promise<FakeCollectData[]>;
		/**
		 * Reset expected faked Application Insights calls.
		 * */
		reset(): void;
	}
	class CollectData {
		
		constructor(uri: string, method: string, headers: Record<string, any>, body: any);
		uri: string;
		method: string;
		body: any;
		headers: Record<string, any>;
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
		message?: string;
		severityLevel?: number;
		[x: string]: any;
	  };
	};
	iKey: string;
	name: string;
	time: string;
  }

  interface FakeCollectData {
	/** request uri */
	uri: string;
	/** request method */
	method: string;
	headers: Record<string, any>;
	body: FakeCollectBody;
  }

	export {};
}

//# sourceMappingURL=index.d.ts.map