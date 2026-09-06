export type DeliveryState = "pending" | "sending" | "sent" | "failed" | "completed";

export function belongsToTenant(recordTenantId: string | null, tenantId: string | undefined): boolean {
  return Boolean(tenantId && recordTenantId === tenantId);
}

export function allSelectedFormsSent(states: DeliveryState[]): boolean {
  return states.length > 0 && states.every((state) => state === "sent" || state === "completed");
}

export function allDeliveredFormsCompleted(states: DeliveryState[]): boolean {
  return states.length > 0 && states.every((state) => state === "completed");
}

export function submittedPacketIsComplete(states: DeliveryState[]): boolean {
  // Phone/manual fill has no delivery packet; one valid submission completes
  // that path. Email packets require every durable delivery to be completed.
  return states.length === 0 || allDeliveredFormsCompleted(states);
}

export function requiresFormsForNewClient(contactPreferenceEnabled: boolean, contactPreference: "email" | "phone"): boolean {
  return contactPreferenceEnabled && contactPreference === "email";
}

export function creationFormSelectionError(
  contactPreferenceEnabled: boolean,
  contactPreference: "email" | "phone",
  formIds: string[],
): string | null {
  return requiresFormsForNewClient(contactPreferenceEnabled, contactPreference) && formIds.length === 0
    ? "Select at least one intake form to send."
    : null;
}

type TenantContext = { id: string; name: string; fromEmail?: string | null; primaryColor?: string | null };
type ClientRecord = { id: string; tenantId: string | null; email: string; displayId: string; status: string; formsSentAt: Date | null };
type FormRecord = { id: string; tenantId: string | null; title: string };
type DeliveryRecord = {
  id: string;
  tenantId: string;
  clientId: string;
  formTemplateId: string;
  status: DeliveryState;
  attemptCount: number;
  idempotencyKey: string;
};

export class FormDeliveryRequestError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

export interface FormDeliveryDependencies {
  getClient(id: string): Promise<ClientRecord | undefined>;
  getForm(id: string): Promise<FormRecord | undefined>;
  prepare(clientId: string, formIds: string[], tenantId: string): Promise<DeliveryRecord[]>;
  list(clientId: string, tenantId: string): Promise<DeliveryRecord[]>;
  claim(id: string, tenantId: string, leaseToken: string, staleBefore: Date): Promise<DeliveryRecord | undefined>;
  finish(id: string, tenantId: string, leaseToken: string, status: "sent" | "failed", error?: string): Promise<DeliveryRecord | undefined>;
  updateClient(id: string, updates: { status: "Forms Sent"; formsSentAt: Date }): Promise<unknown>;
  buildEmail(form: FormRecord, url: string, tenant: TenantContext): Promise<any>;
  sendEmail(options: any): Promise<{ success: boolean }>;
  activity(action: string, form: FormRecord, client: ClientRecord, details?: Record<string, unknown>): Promise<void>;
  uuid(): string;
  now(): Date;
}

export interface FormDeliveryBatchResult {
  success: boolean;
  outcomes: { formId: string; status: DeliveryState; retried: boolean; error?: "delivery_failed" }[];
  message: string;
}

export async function executeFormDeliveryBatch(
  input: { tenant: TenantContext; clientId: string; formIds: string[]; baseUrl: string },
  deps: FormDeliveryDependencies,
): Promise<FormDeliveryBatchResult> {
  const formIds = Array.from(new Set(input.formIds.filter(Boolean)));
  if (!input.clientId || formIds.length === 0) throw new FormDeliveryRequestError(400, "clientId and at least one formId are required");

  const client = await deps.getClient(input.clientId);
  if (!client) throw new FormDeliveryRequestError(404, "Client not found");
  if (!belongsToTenant(client.tenantId, input.tenant.id)) throw new FormDeliveryRequestError(403, "Access denied");

  const forms = await Promise.all(formIds.map(deps.getForm));
  if (forms.some((form) => !form)) throw new FormDeliveryRequestError(404, "Form not found");
  if (forms.some((form) => !belongsToTenant(form!.tenantId, input.tenant.id))) {
    throw new FormDeliveryRequestError(403, "Access denied");
  }

  const deliveries = await deps.prepare(client.id, formIds, input.tenant.id);
  const outcomes: FormDeliveryBatchResult["outcomes"] = [];
  for (const form of forms as FormRecord[]) {
    const delivery = deliveries.find((item) => item.formTemplateId === form.id)!;
    if (delivery.status === "sent" || delivery.status === "completed") {
      outcomes.push({ formId: form.id, status: delivery.status, retried: false });
      continue;
    }
    const leaseToken = deps.uuid();
    const claimed = await deps.claim(delivery.id, input.tenant.id, leaseToken, deps.now());
    if (!claimed) {
      const current = (await deps.list(client.id, input.tenant.id)).find((item) => item.id === delivery.id);
      outcomes.push({ formId: form.id, status: current?.status || "sending", retried: false });
      continue;
    }
    const retried = claimed.attemptCount > 1;
    if (retried) await deps.activity("activity_form_delivery_retried", form, client);

    const email = await deps.buildEmail(form, `${input.baseUrl}/fill/${client.id}/${form.id}`, input.tenant);
    const sent = await deps.sendEmail({ ...email, to: client.email, idempotencyKey: claimed.idempotencyKey });
    if (sent.success) {
      const finished = await deps.finish(delivery.id, input.tenant.id, leaseToken, "sent");
      if (finished) await deps.activity("activity_form_sent", form, client);
      outcomes.push({ formId: form.id, status: finished?.status || "sending", retried });
    } else {
      const finished = await deps.finish(delivery.id, input.tenant.id, leaseToken, "failed", "delivery_failed");
      if (finished) await deps.activity("activity_form_delivery_failed", form, client, { error: "delivery_failed" });
      outcomes.push({ formId: form.id, status: finished?.status || "sending", error: "delivery_failed", retried });
    }
  }

  const current = await deps.list(client.id, input.tenant.id);
  const allDelivered = allSelectedFormsSent(current.map((delivery) => delivery.status));
  // Reconcile from durable state even when this request found every row already
  // sent (for example, after a crash between final send persistence and this
  // client update). Never move a later workflow stage backwards.
  if (
    allDelivered
    && (client.status === "New" || client.status === "Forms Sent")
    && (client.status !== "Forms Sent" || !client.formsSentAt)
  ) {
    await deps.updateClient(client.id, { status: "Forms Sent", formsSentAt: client.formsSentAt || deps.now() });
  }
  const failed = current.some((delivery) => delivery.status === "failed");
  return {
    success: !failed && allDelivered,
    outcomes,
    message: failed ? "Some forms could not be sent" : allDelivered ? "Forms sent successfully" : "Forms are still being sent",
  };
}