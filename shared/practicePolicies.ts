// Explicit practice identity; never infer practice-specific behaviour from an
// editable display name or an unrelated feature flag.
export const CYA_PSYCHOLOGY_TENANT_ID = "92fbc179-2b4e-41e9-9326-4d8e008ca5be";

export function isCyaPsychologyTenant(tenantId?: string | null): boolean {
  return tenantId === CYA_PSYCHOLOGY_TENANT_ID;
}
