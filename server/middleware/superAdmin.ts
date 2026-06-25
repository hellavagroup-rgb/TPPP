import type { Request, Response, NextFunction } from "express";

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers['x-super-admin-key'] as string) || (req.query.superAdminKey as string);
  const expected = process.env.SUPER_ADMIN_KEY;

  if (!expected) {
    return res.status(503).json({ error: "Super admin access not configured on this server" });
  }

  if (!key || key !== expected) {
    return res.status(401).json({ error: "Invalid super admin key" });
  }

  next();
}
