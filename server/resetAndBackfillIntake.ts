/**
 * Clears existing test intake messages for Tenant A, re-inserts them with
 * realistic structured bodies, then immediately parses them into extractedData.
 * Run with: npx tsx server/resetAndBackfillIntake.ts
 */
import { db } from "./db";
import { intakeMessages } from "../shared/schema";
import { eq } from "drizzle-orm";
import { parseIntakeEmailBody } from "./intakeParser";

const TENANT_A_ID = "11111111-0000-0000-0000-000000000001";

const TEST_MESSAGES = [
  {
    tenantId: TENANT_A_ID,
    channel: "email" as const,
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
    status: "new" as const,
  },
  {
    tenantId: TENANT_A_ID,
    channel: "email" as const,
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
    status: "new" as const,
  },
];

async function run() {
  // Clear existing test messages
  const deleted = await db
    .delete(intakeMessages)
    .where(eq(intakeMessages.tenantId, TENANT_A_ID))
    .returning({ id: intakeMessages.id });
  console.log(`Deleted ${deleted.length} existing messages`);

  // Insert fresh messages and immediately parse them
  for (const msg of TEST_MESSAGES) {
    const parsed = parseIntakeEmailBody(msg.body);
    const [inserted] = await db.insert(intakeMessages).values({
      ...msg,
      extractedName: parsed.name,
      extractedPhone: parsed.phone,
      extractedData: parsed.fields,
    } as any).returning({ id: intakeMessages.id, threadId: intakeMessages.threadId });
    console.log(`Inserted ${inserted.threadId} — extracted name: ${parsed.name}, phone: ${parsed.phone}`);
    console.log(`  Fields parsed: ${Object.keys(parsed.fields).length}`);
  }
  console.log("Done.");
}

run().catch(console.error).finally(() => process.exit(0));
