import { db } from "./db";
import { tenants, intakeMessages } from "../shared/schema";
import { eq } from "drizzle-orm";
import { parseIntakeEmailBody } from "./intakeParser";

const TENANT_A_ID = "11111111-0000-0000-0000-000000000001";
const TENANT_B_ID = "22222222-0000-0000-0000-000000000002";

const SEED_MESSAGES = [
  {
    threadId: "thread-001",
    fromAddress: "emma.jones@email.com",
    subject: "New enquiry: Therapy Enquiry Form",
    body: [
      "Your Name", "Emma Jones",
      "Email", "emma.jones@email.com",
      "Phone", "07711 222333",
      "I am looking for", "Therapy for myself",
      "What are your main concerns at the moment?", "Anxiety and low mood during pregnancy",
      "How long have these difficulties been present?", "2-6 weeks",
      "Where would you like support to take place?", "Online",
      "Availability", "Weekday mornings",
      "Our current fees are £200-250 per session. Does this feel manageable for you?", "Yes",
      "Additional comments", "I am 28 weeks pregnant. My GP suggested I reach out.",
    ].join("\n"),
  },
  {
    threadId: "thread-002",
    fromAddress: "sarah.m@outlook.com",
    subject: "New enquiry: Therapy Enquiry Form",
    body: [
      "Your Name", "Sarah Mitchell",
      "Email", "sarah.m@outlook.com",
      "Phone", "07922 481205",
      "I am looking for", "Therapy for myself",
      "What are your main concerns at the moment?", "Birth trauma",
      "Please briefly describe what you're most worried about right now",
        "I gave birth 3 months ago and have been having flashbacks and nightmares about the experience.",
      "How long have these difficulties been present?", "More than 6 weeks",
      "Have you had therapy before?", "No",
      "Are there any immediate safety concerns?", "None of the above",
      "Where would you like support to take place?", "Online",
      "Availability", "Evenings or weekends",
      "Our current fees are £200-250 per session. Does this feel manageable for you?", "Yes",
    ].join("\n"),
  },
];

async function run() {
  await db.update(tenants).set({ gmailIntakeEnabled: true }).where(eq(tenants.id, TENANT_A_ID));
  await db.update(tenants).set({ gmailIntakeEnabled: false }).where(eq(tenants.id, TENANT_B_ID));
  console.log("Tenant flags set (A=enabled, B=disabled)");

  for (const msg of SEED_MESSAGES) {
    const parsed = parseIntakeEmailBody(msg.body);
    await db.insert(intakeMessages).values({
      tenantId: TENANT_A_ID,
      channel: "email" as const,
      threadId: msg.threadId,
      fromAddress: msg.fromAddress,
      subject: msg.subject,
      body: msg.body,
      extractedName: parsed.name,
      extractedPhone: parsed.phone,
      extractedData: parsed.fields,
      status: "new" as const,
    } as any).onConflictDoNothing();
  }

  console.log("2 intake messages inserted (with parsed extractedData) for Tenant A");
  console.log("Tenant B has gmailIntakeEnabled=false — no messages needed");
}

run().catch(console.error).finally(() => process.exit(0));
