import { db } from "../db";
import { users, tenants } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function requireTenant(req: any, res: any, next: any) {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await db
      .select({ tenant: tenants })
      .from(users)
      .innerJoin(tenants, eq(users.tenantId, tenants.id))
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!result.length || !result[0].tenant) {
      return res.status(403).json({ error: "No tenant found for this user" });
    }

    req.tenant = result[0].tenant;
    next();
  } catch (err) {
    console.error("Tenant middleware error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}
