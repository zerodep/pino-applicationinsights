import { executionAsyncResource, createHook } from 'async_hooks';

export const requestState = Symbol('state');

createHook({
  init(_asyncId, _type, _triggerAsyncId, resource) {
    const cr = executionAsyncResource();
    if (cr) {
      resource[requestState] = cr[requestState];
    }
  },
}).enable();

export function context() {
  return function contextMiddleware(req, res, next) {
    executionAsyncResource()[requestState] = { url: req.url, user: res.locals.user };
    next();
  };
}

export function getContext() {
  return executionAsyncResource()[requestState];
}
