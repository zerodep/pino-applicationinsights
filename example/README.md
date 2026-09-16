# Example app

A small express app that logs to Application Insights through `@0dep/pino-applicationinsights`, with basic auth, per-request context and distributed tracing wired up. The root [README](../README.md) links here for the shutdown and statsbeat recipes in [`logger.js`](./logger.js).

<!-- toc -->

- [Configuration](#configuration)
- [Start](#start)
- [Routes](#routes)
- [What to look for](#what-to-look-for)
- [Tests](#tests)

<!-- /toc -->

## Configuration

Configuration is read with [exp-config](https://www.npmjs.com/package/exp-config) from [`config/<NODE_ENV>.json`](./config) in this directory. `NODE_ENV` has to be set, the `start` script sets it to `development`, and [`config/development.json`](./config/development.json) has the connection string set to the placeholder `FROM_ENV`.

Put the real connection string in a `.env` file in this directory:

```sh
applicationinsights.connectionstring=<APPLICATIONINSIGHTS_CONNECTION_STRING>
```

The same key works as an environment variable if you prefer not to keep a `.env` file. Everything under `applicationinsights.config` is passed on to the telemetry client, see [`config/development.json`](./config/development.json).

## Start

From the repository root:

```sh
npm i
npm start -w example
```

or from this directory with `npm start`. The app listens on port 3000. To start it from anywhere else, point exp-config at this directory with an absolute path, `CONFIG_BASE_PATH=/abs/path/to/example NODE_ENV=development node app.js`. A relative path does not work.

## Routes

| Route                | Auth  | Logs                                                                  |
| -------------------- | ----- | --------------------------------------------------------------------- |
| `GET /`              | none  | nothing, plain `Hello`                                                |
| `GET /admin`         | basic | `admin request` at info level with the user as tag overrides          |
| `POST /admin/logout` | basic | `logout` at info level with the username property, replies 401        |
| `GET /error/:code`   | none  | `warn` with the error for 4xx codes, `error` with exception otherwise |

Two users are defined in [`app.js`](./app.js), both with the password `supersecret`:

- `superuser`
- `basicuser`

```sh
curl -u superuser:supersecret http://localhost:3000/admin
curl http://localhost:3000/error/404
curl http://localhost:3000/error/500
```

## What to look for

- **Tag overrides.** The pino `mixin` in [`logger.js`](./logger.js) reads the request context and sets `ai.user.id`, `ai.user.authUserId`, `ai.user.accountId` and `ai.application.ver` on every envelope logged during a request.
- **Distributed tracing.** [`middleware/context.js`](./middleware/context.js) keeps a per-request context in async hooks. An incoming `traceparent` header is parsed and its trace id ends up as `ai.operation.id`, so the logs correlate with the caller's request in Application Insights. Without the header a new trace id is generated.

  ```sh
  curl -u superuser:supersecret -H 'traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' http://localhost:3000/admin
  ```

- **Statsbeat.** The transport runs in a pino worker thread, so `APPLICATION_INSIGHTS_NO_STATSBEAT=disable` is passed through `worker.env` rather than set on the main process.
- **Graceful shutdown.** `SIGTERM` and `SIGINT` flush pino before exiting.

## Tests

The app is exercised offline by [`test/example/example-app-test.js`](../test/example/example-app-test.js) against both `applicationinsights@2` and `@3`. [`test/helpers/setup.js`](../test/helpers/setup.js) sets `NODE_ENV=test` and `CONFIG_BASE_PATH` to this directory so mocha can run from the repository root. [`config/test.json`](./config/test.json) points the connection string at a fake ingestion endpoint intercepted by `FakeApplicationInsights` and sends the pretty log to `./logs/test.log`.

```sh
npx mocha test/example
```
