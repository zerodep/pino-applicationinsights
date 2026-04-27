import { timingSafeEqual, randomUUID, createHash } from 'node:crypto';

/**
 * Basic auth middleware
 * @param {Map<string, User>} users
 * @param {boolean} [allowAnonymous]
 */
export function basicAuth(users, allowAnonymous) {
  /**
   * Basic auth
   * @param {import('express').Request} req
   * @param {import('express').Response<any, {user:User}>} res
   * @param {import('express').NextFunction} next
   */
  return function basicAuth(req, res, next) {
    const authHeader = req.get('Authorization');
    if (!authHeader) {
      if (allowAnonymous) return next();
      return sendUnauthorized(res);
    }

    const auth = Buffer.from(authHeader.substring(6), 'base64').toString();
    const [username, password] = auth.split(':');

    try {
      const user = authenticate(users, username, password);
      if (!user && !allowAnonymous) {
        return sendUnauthorized(res);
      }

      // @ts-ignore
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
 * @returns {User|undefined} user
 */
function authenticate(users, username, password) {
  const user = users.get(username.toLowerCase());
  const challengeHash = sha256(password || randomUUID());

  if (!user) {
    timingSafeEqual(challengeHash, challengeHash);
    return;
  }

  if (!timingSafeEqual(sha256(user.password), challengeHash)) {
    return;
  }

  // @ts-ignore
  return { username, ...user };
}

/**
 * SHA-256 digest of a UTF-8 string as a 32-byte Buffer
 * @param {string} value
 * @returns {Buffer}
 */
function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest();
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
 * @property {string} password
 * @property {string} [email]
 * @property {string[]} [role]
 */
