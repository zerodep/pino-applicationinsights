import { fileURLToPath } from 'url';
import express from 'express';
import logger from './logger.js';
import { basicAuth } from './middleware/auth.js';
import { context } from './middleware/context.js';
import { HttpError } from './middleware/errors.js';

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

const app = express();

const users = new Map([
  ['superuser', { name: 'Jane Bananberg', email: 'jane.bananberg@example.local', password: 'supersecret' }],
  ['basicuser', { name: 'Jan Bananberg', email: 'jan.bananberg@example.local', password: 'supersecret' }],
]);

app.use('/admin', basicAuth(users));
app.use(context());

app.get('/', (_req, res) => {
  res.send('Hello');
});

app.get('/admin', (_req, res) => {
  logger.info('admin request');
  res.send('Hello admin');
});

app.use(errorHandler);

if (isMainModule) {
  const server = app.listen(3000, () => {
    logger.debug('app listening to %d', server.address().port);
  });
}

export { app };

/**
 * Error handler
 * @param {Error} err
 * @param {import('express').Request} _req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, _req, res, next) {
  if (!(err instanceof Error)) return next();

  if (err instanceof HttpError) {
    logger.warn(err, 'Failed with %d', err.statusCode);
    return res.status(err.statusCode).send({ message: err.message });
  }

  logger.error(err, 'Failed');
  res.status(502).send({ message: err.message });
}
