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
      subject: "New enquiry: Therapy Enquiry Form",
      body: `Your Name\nEmma Jones\nEmail\nemma.jones@email.com\nPhone\n07711 222333\nI am looking for\nTherapy for myself\nWhat are your main concerns at the moment?\nAnxiety and low mood during pregnancy\nHow long have these difficulties been present?\n2-6 weeks\nWhere would you like support to take place?\nOnline\nAvailability\nWeekday mornings\nOur current fees are £200-250 per session. Does this feel manageable for you?\nYes\nAdditional comments\nI am 28 weeks pregnant. My GP suggested I reach out.`,
      extractedName: null,
      extractedPhone: null,
      status: "new" as const,
    },
    {
      tenantId: TENANT_A_ID,
      channel: "email" as const,
      threadId: "thread-002",
      fromAddress: "sarah.m@outlook.com",
      subject: "New enquiry: Therapy Enquiry Form",
      body: `Your Name\nSarah Mitchell\nEmail\nsarah.m@outlook.com\nPhone\n07922 481205\nI am looking for\nTherapy for myself\nWhat are your main concerns at the moment?\nBirth trauma\nPlease briefly describe what you're most worried about right now\nI gave birth 3 months ago and have been having flashbacks and nightmares about the experience.\nHow long have these difficulties been present?\nMore than 6 weeks\nHave you had therapy before?\nNo\nAre there any immediate safety concerns?\nNone of the above\nWhere would you like support to take place?\nOnline\nAvailability\nEvenings or weekends\nOur current fees are £200-250 per session. Does this feel manageable for you?\nYes`,
      extractedName: null,
      extractedPhone: null,
      status: "new" as const,
    },
  ] as any[]).onConflictDoNothing();

  console.log("2 intake messages inserted for Tenant A");
  console.log("Tenant B has gmailIntakeEnabled=false — no messages needed");
}

run().catch(console.error).finally(() => process.exit(0));
