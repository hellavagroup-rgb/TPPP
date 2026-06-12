import { db } from "./db";
import { tenants, intakeMessages } from "../shared/schema";
import { eq } from "drizzle-orm";

const TENANT_A_ID = "11111111-0000-0000-0000-000000000001";
const TENANT_B_ID = "22222222-0000-0000-0000-000000000002";

async function run() {
  await db.update(tenants).set({ gmailIntakeEnabled: true }).where(eq(tenants.id, TENANT_A_ID));
  await db.update(tenants).set({ gmailIntakeEnabled: false }).where(eq(tenants.id, TENANT_B_ID));
  console.log("Tenant flags set (A=enabled, B=disabled)");

  await db.insert(intakeMessages).values([
    {
      tenantId: TENANT_A_ID,
      channel: "email" as const,
      threadId: "thread-001",
      fromAddress: "emma.jones@email.com",
      subject: "Enquiry about therapy support",
      body: "Hi, I am currently 28 weeks pregnant and have been struggling with anxiety. My GP suggested I reach out. My name is Emma Jones and my number is 07711 222333. I am available most weekday mornings.",
      extractedName: "Emma Jones",
      extractedPhone: "07711 222333",
      status: "new" as const,
    },
    {
      tenantId: TENANT_A_ID,
      channel: "email" as const,
      threadId: "thread-002",
      fromAddress: "sarah.m@outlook.com",
      subject: "Birth trauma support",
      body: "Hello, I gave birth 3 months ago and have been having flashbacks and nightmares about the experience. I was told you specialise in birth trauma. Could you let me know availability and costs? Sarah",
      extractedName: null,
      extractedPhone: null,
      status: "new" as const,
    },
  ] as any[]).onConflictDoNothing();

  console.log("2 intake messages inserted for Tenant A");
  console.log("Tenant B has gmailIntakeEnabled=false — no messages needed");
}

run().catch(console.error).finally(() => process.exit(0));
