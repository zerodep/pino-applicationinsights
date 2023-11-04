import nock from 'nock';
import chai from 'chai';

globalThis.expect = chai.expect;

nock.enableNetConnect(/127\.0\.\.1/);
