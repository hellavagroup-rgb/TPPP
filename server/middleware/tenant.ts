import { db } from "../db";
import { users, tenants } from "@shared/schema";
import { eq } from "drizzle-orm";
import { decryptSecret } from "../encryption";

export async function requireTenant(req: any, res: any, next: any) {
  const openPaths = [
    '/auth/login',
    '/auth/logout',
    '/auth/forgot-password',
    '/admin-users/accept-invite',
    '/auth/me',
    '/admin/seed-tenant',
    '/tenant/branding',
  ];

  if (
    openPaths.some(path => req.path === path) ||
    req.path.startsWith('/super-admin/') ||
    req.path === '/super-admin' ||
    req.path.startsWith('/admin-users/invite/') ||
    req.path.startsWith('/clients/public/') ||
    (req.path.startsWith('/forms/') && !req.user?.id) ||
    req.path.startsWith('/form-submissions') ||
    req.path.startsWith('/form-drafts') ||
    req.path === '/stripe/webhook'
  ) {
    return next();
  }

  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await db
      .select({ tenant: tenants })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!result.length || !result[0].tenant) {
      return res.status(403).json({ error: 'No tenant found for this user' });
    }

    const tenant = result[0].tenant;
    // Decrypt Stripe credentials at read time — they are stored encrypted at rest
    // using a STRIPE_ENCRYPTION_KEY env var so plaintext secrets never sit in the DB.
    if (tenant.stripeSecretKey) {
      try { tenant.stripeSecretKey = decryptSecret(tenant.stripeSecretKey); } catch { /* ignore decrypt errors */ }
    }
    if (tenant.stripeWebhookSecret) {
      try { tenant.stripeWebhookSecret = decryptSecret(tenant.stripeWebhookSecret); } catch { /* ignore decrypt errors */ }
    }
    req.tenant = tenant;
    next();
  } catch (err) {
    console.error('Tenant middleware error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
