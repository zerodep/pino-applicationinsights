import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import config from 'exp-config';
import { TelemetryClient } from 'applicationinsights';
import { getContext } from './middleware/context.js';

const nodeRequire = createRequire(fileURLToPath(import.meta.url));
const { version } = nodeRequire('../package.json');

const destination = config.logging?.target === 'file' ? `./logs/${config.envName}.log` : 1;

export const tagKeys = new TelemetryClient(config.applicationinsights.connectionstring).context.keys;

const transport = pino.transport({
  targets: [
    {
      level: config.applicationinsights.loglevel,
      target: '@0dep/pino-applicationinsights',
      worker: {
        env: { ...process.env, APPLICATION_INSIGHTS_NO_STATSBEAT: 'disable' },
      },
      options: {
        connectionString: config.applicationinsights.connectionstring,
        config: {
          disableStatsbeat: true,
          maxBatchSize: 1,
          ...config.applicationinsights.config,
        },
      },
    },
    {
      level: config.loglevel,
      target: 'pino-pretty',
      options: {
        destination,
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: "yyyy-mm-dd'T'HH:MM:ss.l",
      },
    },
  ],
});

export default pino(
  {
    level: config.loglevel,
    /**
     * @param {any} context
     */
    mixin(context) {
      const ctx = getContext();
      if (!ctx) return {};
      return {
        tracing: ctx.tracing,
        tagOverrides: {
          [tagKeys.userId]: ctx.user?.username,
          [tagKeys.userAuthUserId]: ctx.user?.name,
          [tagKeys.userAccountId]: ctx.user?.email,
          [tagKeys.applicationVersion]: version,
          ...context.tagOverrides,
        },
      };
    },
  },
  transport,
);
