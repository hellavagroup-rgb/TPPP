import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// Constant-time string comparison — avoids leaking how many leading
// characters of the super admin key an attacker has guessed correctly via
// response-time differences. A plain `!==` comparison short-circuits on the
// first mismatched byte, which is measurable over many requests.
function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Still run timingSafeEqual (against a same-length dummy) so the
    // length-mismatch path takes comparable time to the match path.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers['x-super-admin-key'] as string) || (req.query.superAdminKey as string);
  const expected = process.env.SUPER_ADMIN_KEY;

  if (!expected) {
    return res.status(503).json({ error: "Super admin access not configured on this server" });
  }

  if (!key || !timingSafeEqualStrings(key, expected)) {
    return res.status(401).json({ error: "Invalid super admin key" });
  }

  next();
}
