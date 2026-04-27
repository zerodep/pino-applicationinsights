import nock from 'nock';

process.env.NODE_ENV = 'test';
process.env.APPLICATION_INSIGHTS_NO_STATSBEAT = 'disable';

nock.enableNetConnect(/127\.0\.0\.1/);
