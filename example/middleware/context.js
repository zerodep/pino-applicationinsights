import { executionAsyncResource, createHook } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

const TRACEPARENT_HEADER_KEY = 'traceparent';
const requestState = Symbol('state');

createHook({
  init(_asyncId, _type, _triggerAsyncId, resource) {
    const cr = executionAsyncResource();
    if (cr) {
      // @ts-ignore
      resource[requestState] = cr[requestState];
    }
  },
}).enable();

/**
 * Context middleware
 * @returns  {import('express').RequestHandler}
 */
export function context() {
  return function contextMiddleware(req, res, next) {
    // @ts-ignore
    executionAsyncResource()[requestState] = { url: req.url, user: res.locals.user, tracing: getTraceFromHeader(req) };
    next();
  };
}

/**
 * Get async request context
 * @returns {{tagOverrides?: Record<string, any>, tracing?: import('@opentelemetry/api').SpanContext, [k:string]: any}}
 */
export function getContext() {
  // @ts-ignore
  return executionAsyncResource()[requestState];
}

/**
 * Express trace id from header
 * @param {import('express').Request} req
 */
export function getTraceFromHeader(req) {
  let traceHeader;
  const spanId = createSpanId();
  let traceFlags = 0;

  if ((traceHeader = req.headers[TRACEPARENT_HEADER_KEY])) {
    // @ts-ignore
    const [, traceId, , flagsStr] = traceHeader.split('-');
    traceFlags = parseInt(flagsStr, 16);

    return { traceId, spanId, flags: traceFlags, fromHeader: TRACEPARENT_HEADER_KEY, headerValue: traceHeader };
  }

  return { traceId: createTraceId(), spanId, flags: traceFlags, fromHeader: TRACEPARENT_HEADER_KEY };
}

/**
 * Create new trace id
 * @returns 16 random bytes as hex
 */
export function createTraceId() {
  return randomBytes(16).toString('hex');
}

/**
 * Create new span id
 * @returns 8 random bytes as hex string
 */
export function createSpanId() {
  return randomBytes(8).toString('hex');
}
