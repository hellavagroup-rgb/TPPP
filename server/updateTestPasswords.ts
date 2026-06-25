import { db } from "./db";
import { users } from "../shared/schema";
import { inArray } from "drizzle-orm";

const NEW_HASH =
  "fcb409dfa9deef417f034fbb3122e06ae20d47362393f0e0882a256d2dae5a5c18b0d2e41246fb5be12e6e0570aeacb156a3faac32d133fcfe9512b1a5d37925.a5e9b48006f6596c64a5231f551ae24c";

const TEST_EMAILS = [
  "admin@practice-a.test",
  "sara@practice-a.test",
  "james@practice-a.test",
  "admin@riverside.test",
  "lucy@riverside.test",
  "mark@riverside.test",
];

async function run() {
  const result = await db
    .update(users)
    .set({ password: NEW_HASH })
    .where(inArray(users.email, TEST_EMAILS))
    .returning({ email: users.email });

  console.log(`Updated ${result.length} users:`);
  result.forEach((u) => console.log(" ", u.email));
}

run().catch(console.error).finally(() => process.exit(0));
