import { fileURLToPath } from 'node:url';
import nock from 'nock';

process.env.NODE_ENV = 'test';
process.env.CONFIG_BASE_PATH = fileURLToPath(new URL('../../example/', import.meta.url));
process.env.APPLICATION_INSIGHTS_NO_STATSBEAT = 'disable';

nock.enableNetConnect(/127\.0\.0\.1/);
