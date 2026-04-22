import { mock } from 'node:test';
import { mkdirSync } from 'node:fs';
import { pino } from 'pino';
import config from 'exp-config';
import request from 'supertest';

mkdirSync('./logs', { recursive: true });

const exampleLoggerUrl = new URL('../../example/logger.js', import.meta.url).href;
const connectionString = config.applicationinsights.connectionstring;

const basicAuthHeader = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

let cacheBust = 0;

['applicationinsights', 'applicationinsights-v3'].forEach((version) => {
  describe(`example app with ${version}`, () => {
    /** @type {import('express').Express} */
    let app;
    /** @type {ReturnType<typeof mock.module> | undefined} */
    let moduleMock;

    before(async () => {
      const ai = await import(version);

      moduleMock = mock.module('applicationinsights', { cache: false, namedExports: ai });

      const bust = `?ex-v=${version}-${++cacheBust}`;
      ({ app } = await import(`../../example/app.js${bust}`));
    });

    after(() => {
      moduleMock?.restore();
    });

    it('GET / returns "Hello"', async () => {
      const res = await request(app).get('/');
      expect(res.status).to.equal(200);
      expect(res.text).to.equal('Hello');
    });

    it('GET /admin without auth returns 401 + WWW-Authenticate', async () => {
      const res = await request(app).get('/admin');
      expect(res.status).to.equal(401);
      expect(res.headers['www-authenticate']).to.match(/^Basic realm=/);
    });

    it('GET /admin with valid basic auth returns the admin HTML page with a logout button', async () => {
      const res = await request(app).get('/admin').set('authorization', basicAuthHeader('superuser', 'supersecret'));
      expect(res.status).to.equal(200);
      expect(res.headers['content-type']).to.match(/^text\/html/);
      expect(res.text).to.include('<h1>Hello Jane Bananberg</h1>');
      expect(res.text).to.include('<form method="POST" action="/admin/logout">');
      expect(res.text).to.include('<button type="submit">Logout</button>');
    });

    it('GET /admin with bad password returns 401', async () => {
      const res = await request(app).get('/admin').set('authorization', basicAuthHeader('superuser', 'wrong'));
      expect(res.status).to.equal(401);
    });

    it('POST /admin/logout with valid basic auth replies 401 + WWW-Authenticate so the browser drops the cached credentials', async () => {
      const res = await request(app).post('/admin/logout').set('authorization', basicAuthHeader('basicuser', 'supersecret'));
      expect(res.status).to.equal(401);
      expect(res.headers['www-authenticate']).to.match(/^Basic realm=/);
    });

    it('POST /admin/logout without auth returns 401 (caught by the basicAuth middleware before the handler runs)', async () => {
      const res = await request(app).post('/admin/logout');
      expect(res.status).to.equal(401);
    });
  });

  describe(`example app forwards logs to Application Insights via ${version}`, () => {
    /** @type {import('express').Express} */
    let inProcessApp;
    /** @type {import('../../src/fake-applicationinsights.js').FakeApplicationInsights} */
    let fakeAI;
    /** @type {Record<string, string>} */
    let tagKeys;
    /** @type {Array<ReturnType<typeof mock.module>>} */
    const moduleMocks = [];

    before(async () => {
      const ai = await import(version);
      const TelemetryClient = ai.TelemetryClient;
      moduleMocks.push(mock.module('applicationinsights', { cache: false, namedExports: ai }));

      for (const method of ['trackTrace', 'trackException', 'trackEvent', 'trackMetric']) {
        const original = TelemetryClient.prototype[method];
        if (typeof original !== 'function') continue;
        mock.method(TelemetryClient.prototype, method, function autoFlush(...args) {
          const result = original.apply(this, args);
          if (typeof this.flush === 'function') this.flush();
          return result;
        });
      }

      const bust = `?ex-fai-v=${version}-${++cacheBust}`;
      const compose = (await import(`../../src/index.js${bust}`)).default;
      const { FakeApplicationInsights } = await import(`../../src/fake-applicationinsights.js${bust}`);
      const { getContext } = await import(`../../example/middleware/context.js`);

      fakeAI = new FakeApplicationInsights(connectionString);

      const transport = compose({ connectionString, config: { maxBatchSize: 1, disableStatsbeat: true } });
      tagKeys = new TelemetryClient(connectionString).context.keys;
      const inProcessLogger = pino(
        {
          level: 'trace',
          mixin(ctx) {
            const rc = getContext();
            if (!rc) return {};
            return {
              tracing: rc.tracing,
              tagOverrides: {
                [tagKeys.userId]: rc.user?.username,
                ...ctx.tagOverrides,
              },
            };
          },
        },
        transport,
      );

      moduleMocks.push(
        mock.module(exampleLoggerUrl, {
          defaultExport: inProcessLogger,
          namedExports: { tagKeys },
        }),
      );

      ({ app: inProcessApp } = await import(`../../example/app.js?ex-fai-v=${version}-${++cacheBust}`));
    });

    after(() => {
      fakeAI.reset();
      for (const m of moduleMocks.splice(0)) m.restore();
    });

    it('logs "admin request" as a MessageData envelope when GET /admin is hit', async () => {
      const expectMessage = fakeAI.expectMessageData();

      const res = await request(inProcessApp).get('/admin').set('authorization', basicAuthHeader('superuser', 'supersecret'));
      expect(res.status).to.equal(200);

      const msg = await expectMessage;
      expect(msg.body.data.baseType).to.equal('MessageData');
      expect(msg.body.data.baseData.message).to.equal('admin request');
    });

    it('logs "logout" with the username property when POST /admin/logout is hit', async () => {
      const expectMessage = fakeAI.expectMessageData();

      const res = await request(inProcessApp).post('/admin/logout').set('authorization', basicAuthHeader('basicuser', 'supersecret'));
      expect(res.status).to.equal(401);

      const msg = await expectMessage;
      expect(msg.body.data.baseData.message).to.equal('logout');
      expect(msg.body.data.baseData.properties).to.include({ username: 'basicuser' });
    });

    describe('traceparent header correlation', () => {
      const traceId = '0af7651916cd43dd8448eb211c80319c';
      const upstreamSpanId = 'b7ad6b7169203331';
      const traceparent = `00-${traceId}-${upstreamSpanId}-01`;

      it('GET /admin with traceparent stamps ai.operation.id on the MessageData envelope', async () => {
        const expectMessage = fakeAI.expectMessageData();

        const res = await request(inProcessApp)
          .get('/admin')
          .set('authorization', basicAuthHeader('superuser', 'supersecret'))
          .set('traceparent', traceparent);
        expect(res.status).to.equal(200);

        const msg = await expectMessage;
        expect(msg.body.data.baseData.message).to.equal('admin request');
        expect(msg.body.tags).to.have.property(tagKeys.operationId, traceId);
        expect(msg.body.tags[tagKeys.operationParentId]).to.match(/^[0-9a-f]{16}$/);
      });

      it('POST /admin/logout with traceparent stamps correlation on both trace and wire envelopes', async () => {
        const expectMessage = fakeAI.expectMessageData();

        const res = await request(inProcessApp)
          .post('/admin/logout')
          .set('authorization', basicAuthHeader('basicuser', 'supersecret'))
          .set('traceparent', traceparent);
        expect(res.status).to.equal(401);

        const msg = await expectMessage;
        expect(msg.body.tags).to.have.property(tagKeys.operationId, traceId);
        expect(msg.body.tags[tagKeys.operationParentId]).to.match(/^[0-9a-f]{16}$/);
      });

      it('GET /admin without traceparent still stamps a locally-generated operation id', async () => {
        const expectMessage = fakeAI.expectMessageData();

        const res = await request(inProcessApp).get('/admin').set('authorization', basicAuthHeader('superuser', 'supersecret'));
        expect(res.status).to.equal(200);

        const msg = await expectMessage;
        expect(msg.body.tags[tagKeys.operationId]).to.match(/^[0-9a-f]{32}$/);
        expect(msg.body.tags[tagKeys.operationId]).to.not.equal(traceId);
        expect(msg.body.tags[tagKeys.operationParentId]).to.match(/^[0-9a-f]{16}$/);
      });
    });
  });
});
