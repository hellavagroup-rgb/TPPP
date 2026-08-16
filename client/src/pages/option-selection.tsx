import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, UserX, Clock, MapPin } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface OptionDetail {
  id: string;
  status: string;
  clinicianName: string;
  slot: {
    type: string | null;
    day: string | null;
    date: string | null;
    startTime: string;
    endTime: string;
    locationType: string;
  } | null;
}

interface OptionsData {
  options: OptionDetail[];
  clientStatus: string;
  tenantName: string;
  primaryColor: string | null;
}

function formatTime(t: string) {
  // t is like "09:00" — convert to "9:00 AM"
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export default function OptionSelection() {
  const [, params] = useRoute("/options/:selectionToken");
  const [, setLocation] = useLocation();
  const selectionToken = params?.selectionToken || "";
  const [submitted, setSubmitted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<OptionsData>({
    queryKey: ["options", selectionToken],
    queryFn: async () => {
      const res = await fetch(`/api/public/options/${selectionToken}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!selectionToken,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: async (body: { clinicianOptionId?: string; decline?: boolean }) => {
      const res = await fetch(`/api/public/options/${selectionToken}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit");
      }
      return res.json();
    },
    onSuccess: (result) => {
      if (result.declined) {
        setDeclined(true);
      } else if (result.registrationUrl) {
        // Redirect to registration form
        setLocation(result.registrationUrl);
      } else {
        setSubmitted(true);
      }
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

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
            <p className="text-muted-foreground">This link is invalid or has expired. Please contact your practice for a new link.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Already actioned (status beyond OptionsSent means the client already chose)
  const alreadyActioned = data.clientStatus === "OptionSelected" || data.clientStatus === "RegistrationPending" || data.clientStatus === "BookingConfirmed";

  if (declined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4" style={{ color: primaryColor }} />
            <h2 className="text-xl font-semibold mb-2">Thank you for letting us know</h2>
            <p className="text-muted-foreground">
              A member of our team will be in touch shortly to discuss alternative options.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (alreadyActioned && !submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-green-500" />
            <h2 className="text-xl font-semibold mb-2">You have already made your selection</h2>
            <p className="text-muted-foreground">
              Your choice has been recorded. Please check your email for the next steps.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div
          className="rounded-t-xl p-6 text-center mb-0"
          style={{ backgroundColor: primaryColor }}
        >
          <h1 className="text-2xl font-bold text-white">{tenantName}</h1>
          <p className="text-white/90 mt-1 text-sm">Clinician Options</p>
        </div>

        <div className="bg-white rounded-b-xl shadow p-6 mb-6">
          <p className="text-slate-600 text-sm">
            We have matched you with the following clinician{data.options.length !== 1 ? "s" : ""}. Please select the option that works best for you,
            or let us know if none of these options are suitable.
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 mb-6">
          {data.options.map((option, idx) => (
            <Card key={option.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Option {idx + 1}: {option.clinicianName}
                </CardTitle>
                {option.slot && (
                  <CardDescription className="flex flex-col gap-1 mt-1">
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      {option.slot.type === "SpecificDate" && option.slot.date
                        ? (() => {
                            const [y, m, d] = option.slot.date.split("-").map(Number);
                            return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                          })()
                        : option.slot.day}{" "}
                      {formatTime(option.slot.startTime)} – {formatTime(option.slot.endTime)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {option.slot.locationType === "in_person" ? "In person" : "Online"}
                    </span>
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  className="w-full"
                  style={{ backgroundColor: primaryColor, color: "#fff" }}
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ clinicianOptionId: option.id })}
                >
                  {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Select this option
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Decline option */}
        <Card className="border-dashed">
          <CardContent className="pt-5 pb-5 text-center">
            <UserX className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-3">
              None of these options work for me
            </p>
            <Button
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ decline: true })}
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              None of these work for me
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          {tenantName}
        </p>
      </div>
    </div>
  );
}
