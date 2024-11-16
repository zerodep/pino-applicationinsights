import { timingSafeEqual, randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';

/**
 * Basic auth middleware
 * @param {Map<string, string>} users
 * @param {boolean} [allowAnonymous]
 */
export function basicAuth(users, allowAnonymous) {
  /**
   * Basic auth
   * @param {import('express').Request} req
   * @param {import('express').Response<any, {user:User}>} res
   * @param {import('express').NextFunction} next
   */
  return async function basicAuth(req, res, next) {
    const authHeader = req.get('Authorization');
    if (!authHeader) {
      if (allowAnonymous) return next();
      return sendUnauthorized(res);
    }

    const auth = Buffer.from(req.get('Authorization').substring(6), 'base64').toString();
    const [username, password] = auth.split(':');

    try {
      const user = await authenticate(users, username, password);
      if (!user && !allowAnonymous) {
        return sendUnauthorized(res);
      }

      res.locals.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Authenticate user
 * @param {Map<string, User>} users
 * @param {string} username
 * @param {string} password
 * @returns {Promise<User|undefined>} user
 */
function authenticate(users, username, password) {
  const user = users.get(username.toLowerCase());
  const challengePassword = Buffer.from(password || randomUUID());

  if (!user) {
    timingSafeEqual(challengePassword, challengePassword);
    return;
  }

  const bufferSize = challengePassword.length > user.password.length ? challengePassword.length : user.password.length;

  if (!timingSafeEqual(Buffer.alloc(bufferSize, user.password), Buffer.alloc(bufferSize, challengePassword))) {
    return;
  }

  return { username, ...user };
}

/**
 * Basic auth
 * @param {import('express').Request} _req
 * @param {import('express').Response<any, {user:import('./auth.js').User}>} res
 * @param {import('express').NextFunction} next
 */
export async function authorize(_req, res, next) {
  try {
    /** @type {import('bpmn-engine').Engine} */
    const engine = res.locals.engine;
    const user = res.locals.user;

    const [definition] = await engine.getDefinitions();
    const [process] = definition.context.getExecutableProcesses();

    if (process.behaviour.candidateStarterGroups) {
      if (!user?.role?.length) {
        throw new HttpError('Forbidden', 403);
      }

      const roles = new Set(process.behaviour.candidateStarterGroups.split(',').filter(Boolean));
      if (!user.role.some((r) => roles.has(r))) {
        throw new HttpError('Forbidden', 403);
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Send unauthorized
 * @param {import('express').Response} res;
 */
function sendUnauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm=pino-applicationinsights');
  return res.sendStatus(401);
}

/**
 * User
 * @typedef {Object} User
 * @property {string} username
 * @property {string} name
 * @property {string[]} [role]
 * @property {string} [password]
 */
