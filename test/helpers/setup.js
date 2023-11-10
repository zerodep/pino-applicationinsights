import nock from 'nock';
import chai from 'chai';

process.env.NODE_ENV = 'test';

globalThis.expect = chai.expect;

nock.enableNetConnect(/127\.0\.\.1/);
