import { parseRegistrationInsurerDetails } from "@shared/insuranceDetails";

export function InsurancePaymentDetails({ client }: {
  client: { paymentType?: string | null; insurer?: string | null; insurerDetails?: string | null };
}) {
  const clientInsurer = client.insurer && client.insurer !== "Private" ? client.insurer : "";
  if (client.paymentType !== "insurer" && !client.insurerDetails && !clientInsurer) return null;
  const saved = parseRegistrationInsurerDetails(client.insurerDetails);
  const insurer = saved.insurerName || clientInsurer;
  return (
    <section className="rounded-lg border bg-white p-4" aria-label="Insurance details">
      <h3 className="text-sm font-semibold">Insurance details</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {client.insurerDetails
          ? "Saved registration information."
          : "The insurer is recorded on the client record. Policy and authorisation details are collected during registration."}
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        {[
          ["Insurer", insurer],
          ["Policy number", saved.insurancePolicyNumber],
          ["Authorisation code", saved.preauthorisationCode],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap break-words">{value || "Not provided"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
