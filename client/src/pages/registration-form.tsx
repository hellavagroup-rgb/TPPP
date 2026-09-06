import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DynamicFormFields, validateDynamicFields } from "@/components/forms/DynamicFormFields";
import { findRegistrationConsent } from "@shared/registrationConsent";

interface RegistrationData {
  tenantName: string;
  primaryColor: string | null;
  termsText: string;
  termsVersion: number;
  agreedRatePence: number | null;
  paymentsEnabled: boolean;
  paymentSetupAvailable: boolean;
  paymentEligibility: "stripe_required" | "confirm_after_form" | "client_rate_required" | "stripe_unavailable" | null;
  alreadySubmitted: boolean;
  savedPaymentType: "self_pay" | "insurer" | null;
  savedInsurerDetails: string | null;
  registrationTemplate?: { id: string; title?: string; fields: any[] } | null;
  registrationTemplateUpdatedAt?: string | null;
}

function formatPence(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function RegistrationForm() {
  const [, params] = useRoute("/register/:clientId/:registrationToken");
  const clientId = params?.clientId || "";
  const registrationToken = params?.registrationToken || "";

  const [paymentType, setPaymentType] = useState<"self_pay" | "insurer">("self_pay");
  const [insurerDetails, setInsurerDetails] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [prefilled, setPrefilled] = useState(false);
  const [templateValues, setTemplateValues] = useState<Record<string, any>>({});
  const [templateErrors, setTemplateErrors] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError, error: loadError } = useQuery<RegistrationData>({
    queryKey: ["registration", clientId, registrationToken],
    queryFn: async () => {
      const res = await fetch(`/api/public/register/${clientId}/${registrationToken}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "This registration link is invalid or has expired.");
      }
      return res.json();
    },
    enabled: !!clientId && !!registrationToken,
    retry: false,
  });

  // Pre-fill saved form data when returning after a Stripe cancel
  useEffect(() => {
    if (data && !prefilled) {
      if (data.savedPaymentType) setPaymentType(data.savedPaymentType);
      if (data.savedInsurerDetails) setInsurerDetails(data.savedInsurerDetails);
      setPrefilled(true);
    }
  }, [data, prefilled]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!data?.termsVersion) {
        throw new Error("The terms and conditions could not be verified. Please reload the page and try again.");
      }
      const res = await fetch(`/api/public/register/${clientId}/${registrationToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentType,
          insurerDetails: paymentType === "insurer" ? insurerDetails : undefined,
          termsAccepted: findRegistrationConsent(data.registrationTemplate?.fields, templateValues)?.accepted === true,
          termsVersion: data.termsVersion,
          registrationTemplateUpdatedAt: data.registrationTemplateUpdatedAt,
          registrationResponses: templateValues,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit");
      }
      return res.json();
    },
    onSuccess: (result) => {
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        setSuccess(true);
      }
    },
    onError: (err: Error) => {
      setFormError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (paymentType === "insurer" && !insurerDetails.trim()) {
      setFormError("Please enter your insurer name and policy details.");
      return;
    }
    if (!data) {
      setFormError("Registration details are unavailable. Please reload the page and try again.");
      return;
    }
    const selfPayBlocked =
      paymentType === "self_pay" &&
      data.paymentsEnabled &&
      (!data.agreedRatePence || data.agreedRatePence <= 0 || !data.paymentSetupAvailable ||
        data.paymentEligibility === "client_rate_required" || data.paymentEligibility === "stripe_unavailable");
    if (selfPayBlocked) {
      setFormError(!data.agreedRatePence || data.paymentEligibility === "client_rate_required"
        ? "Your agreed session rate has not been set. Please contact the practice so an administrator can set it before registration can be submitted."
        : "Online payment setup is unavailable. Please contact the practice so an administrator can complete payment setup before registration can be submitted.");
      return;
    }
    const fields = data.registrationTemplate?.fields || [];
    const dynamicErrors = validateDynamicFields(fields, templateValues);
    if (Object.keys(dynamicErrors).length) {
      setTemplateErrors(dynamicErrors);
      setFormError("Please complete all required registration details.");
      window.setTimeout(() => document.querySelector('[data-error="true"]')?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
      return;
    }
    if (findRegistrationConsent(fields, templateValues)?.accepted !== true) {
      setFormError("Please read and accept the terms and conditions to continue.");
      return;
    }
    if (!data?.termsVersion) {
      setFormError("The terms and conditions could not be verified. Please reload the page and try again.");
      return;
    }

    mutation.mutate();
  };

  const primaryColor = data?.primaryColor || "#4f46e5";
  const tenantName = data?.tenantName || "Your Practice";

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">
              {loadError instanceof Error
                ? loadError.message
                : "This registration link is invalid or has expired. Please contact your practice for assistance."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.alreadySubmitted || success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <h2 className="text-xl font-semibold mb-2">Registration complete</h2>
            <p className="text-muted-foreground">
              Thank you — your registration has been received. We will be in touch to confirm your appointment details.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div
          className="rounded-t-xl p-6 text-center"
          style={{ backgroundColor: primaryColor }}
        >
          <h1 className="text-2xl font-bold text-white">{tenantName}</h1>
          <p className="text-white/90 mt-1 text-sm">Registration Form</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="bg-white rounded-b-xl shadow p-6 space-y-6">
            <p className="text-slate-600 text-sm">
              Please complete the details below to finalise your booking
              {data.agreedRatePence && data.paymentsEnabled
                ? ` and set up your initial session payment of ${formatPence(data.agreedRatePence)}.`
                : "."}
            </p>

            {/* Configured registration questions must be completed before payment details. */}
            {data.registrationTemplate?.fields?.length ? (
              <div className="space-y-5">
                {data.registrationTemplate?.title && <h2 className="text-base font-semibold">{data.registrationTemplate.title}</h2>}
                <DynamicFormFields
                  fields={data.registrationTemplate.fields}
                  values={templateValues}
                  errors={templateErrors}
                  onChange={(id, value) => {
                    setTemplateValues(current => ({ ...current, [id]: value }));
                    setTemplateErrors(current => {
                      if (!current[id]) return current;
                      const next = { ...current };
                      delete next[id];
                      return next;
                    });
                  }}
                />
              </div>
            ) : null}

            {/* Payment Type */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Payment method</Label>
              <RadioGroup
                value={paymentType}
                onValueChange={(v) => setPaymentType(v as "self_pay" | "insurer")}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-slate-50 transition-colors">
                  <RadioGroupItem value="self_pay" id="self_pay" />
                  <div>
                    <Label htmlFor="self_pay" className="font-medium cursor-pointer">Self-pay</Label>
                    <p className="text-xs text-muted-foreground">I will pay for sessions directly</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-slate-50 transition-colors">
                  <RadioGroupItem value="insurer" id="insurer" />
                  <div>
                    <Label htmlFor="insurer" className="font-medium cursor-pointer">Insurance / Insurer</Label>
                    <p className="text-xs text-muted-foreground">My sessions are covered by an insurer</p>
                  </div>
                </div>
              </RadioGroup>
            </div>

            {/* Insurer details — shown only when insurer is selected */}
            {paymentType === "insurer" && (
              <div className="space-y-2">
                <Label htmlFor="insurerDetails" className="text-sm font-medium">
                  Insurer name &amp; policy reference
                </Label>
                <Input
                  id="insurerDetails"
                  placeholder="e.g. Bupa / Policy no. 12345678"
                  value={insurerDetails}
                  onChange={(e) => setInsurerDetails(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Please provide the name of your insurer and your policy or authorisation reference number.
                </p>
              </div>
            )}

            {paymentType === "self_pay" && data.paymentsEnabled && (!data.agreedRatePence || data.agreedRatePence <= 0 || data.paymentEligibility === "client_rate_required") && (
              <Alert variant="destructive">
                <AlertDescription>Your agreed session rate has not been set. An administrator must set it before registration can be submitted.</AlertDescription>
              </Alert>
            )}
            {paymentType === "self_pay" && data.paymentsEnabled && (data.agreedRatePence ?? 0) > 0 && (!data.paymentSetupAvailable || data.paymentEligibility === "stripe_unavailable") && (
              <Alert variant="destructive">
                <AlertDescription>Online payment setup is unavailable. An administrator must complete payment setup before registration can be submitted.</AlertDescription>
              </Alert>
            )}

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              style={{ backgroundColor: primaryColor, color: "#fff" }}
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {data.paymentsEnabled && data.agreedRatePence && paymentType === "self_pay"
                ? `Continue to payment (${formatPence(data.agreedRatePence)})`
                : "Complete registration"}
            </Button>
          </div>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6">{tenantName}</p>
      </div>
    </div>
  );
}
