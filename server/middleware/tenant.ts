import { db } from "../db";
import { users, tenants } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function requireTenant(req: any, res: any, next: any) {
  if (!req.user?.id) {
    return next();
  }

  try {
    const result = await db
      .select({ tenant: tenants })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(eq(users.id, req.user.id))
      .limit(1);

    req.tenant = result[0]?.tenant || null;
    next();
  } catch (err) {
    console.error("Tenant middleware error:", err);
    req.tenant = null;
    next();
  }
}
