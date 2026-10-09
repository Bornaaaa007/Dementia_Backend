import { fromNodeHeaders } from 'better-auth/node';

// Family / caregiver accounts (Better Auth session)
export function makeRequireAuth(auth) {
  return async function requireAuth(req, res, next) {
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session) return res.status(401).json({ error: 'Please log in again', code: 'NO_SESSION' });
      req.user = session.user;
      req.session = session.session;
      next();
    } catch {
      res.status(401).json({ error: 'Please log in again', code: 'NO_SESSION' });
    }
  };
}
