/** Parse saved registration evidence without requiring a new submission. */
export function parseRegistrationInsurerDetails(value: string | null | undefined) {
  const text = value || "";
  return {
    insurerName: text.match(/^Insurer name:[ \t]*(.*)$/mi)?.[1]?.trim() ?? text.trim(),
    insurancePolicyNumber: text.match(/^Insurance policy number:[ \t]*(.*)$/mi)?.[1]?.trim() ?? "",
    preauthorisationCode: text.match(/^Preauthorisation code:[ \t]*(.*)$/mi)?.[1]?.trim() ?? "",
  };
}
