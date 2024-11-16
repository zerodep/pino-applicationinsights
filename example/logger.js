import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import config from 'exp-config';
import { Contracts } from 'applicationinsights';
import { getContext } from './middleware/context.js';

const nodeRequire = createRequire(fileURLToPath(import.meta.url));
const { version } = nodeRequire('../package.json');

const tagKeys = new Contracts.ContextTagKeys();

const cwd = process.cwd();

const transport = pino.transport({
  targets: [
    {
      level: config.applicationinsights.loglevel,
      target: join(cwd, './src/index.js'),
      options: {
        connectionString: config.applicationinsights.connectionstring,
        config: {
          disableStatsbeat: true,
          maxBatchSize: 1,
        },
      },
    },
    {
      level: config.loglevel,
      target: 'pino-pretty',
      options: {
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
    mixin() {
      const ctx = getContext();
      if (!ctx) return {};
      return {
        tagOverrides: {
          [tagKeys.userId]: ctx.user?.username,
          [tagKeys.userAuthUserId]: ctx.user?.name,
          [tagKeys.userAccountId]: ctx.user?.email,
          [tagKeys.applicationVersion]: version,
        },
      };
    },
  },
  transport,
);
