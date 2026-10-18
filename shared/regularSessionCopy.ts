import { formatOfferDate } from "./offerSchedule";
import { practiceToday } from "./slotEligibility";

export { CYA_PSYCHOLOGY_TENANT_ID, isCyaPsychologyTenant as usesRegularSessionCopy } from "./practicePolicies";

export const FIRST_SESSION_TO_AGREE = "First session date: to be agreed.";
export const REGULAR_SESSION_NEXT_STEPS =
  "After you choose a slot and complete registration and the required payment steps, our admin team will contact you to agree your first session date.";
export const REGULAR_SESSION_CONFIRMED = "Your regular session slot is confirmed.";
export const FIRST_SESSION_CONTACT =
  "Our admin team will contact you to agree the date of your first session.";

/** Hide historical window starts, not genuine constraints on when sessions can happen. */
export function regularSessionConstraints(
  startDate?: string | null, endDate?: string | null, today = practiceToday(),
): string[] {
  return [
    startDate && startDate > today
      ? `Available from ${formatOfferDate(startDate)} (earliest possible start; first session date to be agreed).`
      : null,
    endDate ? `Regular slot availability ends ${formatOfferDate(endDate)}.` : null,
  ].filter((line): line is string => Boolean(line));
}
