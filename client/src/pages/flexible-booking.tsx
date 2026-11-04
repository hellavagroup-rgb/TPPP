import { useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Clock3, MapPin, RefreshCw, UserRound, XCircle } from "lucide-react";
import { formatOfferDate, formatOfferFrequency, formatOfferTimeRange, formatOfferWindow } from "@shared/offerSchedule";
import { FIRST_SESSION_TO_AGREE, REGULAR_SESSION_NEXT_STEPS, regularSessionConstraints } from "@shared/regularSessionCopy";
import { slotScheduleFingerprint } from "@shared/availabilityEdit";

type PublicSlot = {
  id: string; type: string; day: string | null; date: string | null;
  startDate: string | null; endDate: string | null; startTime: string; endTime: string;
  frequency: string | null; locationType: string;
};
type Clinician = { id: string; name: string; bio: string | null; sessionRatePence: number | null; slots: PublicSlot[] };
type BookingData = { tenantName: string; primaryColor: string | null; status: string; clinicians: Clinician[]; registrationUrl?: string | null };

export default function FlexibleBooking() {
  const [, params] = useRoute("/book/:token");
  const token = params?.token || "";
  const [selected, setSelected] = useState<{ clinicianId: string; slotId: string } | null>(null);
  const [finished, setFinished] = useState<"declined" | "selected" | null>(null);
  const [actionError, setActionError] = useState("");
  const [resumeRegistrationUrl, setResumeRegistrationUrl] = useState<string | null>(null);
  const booking = useQuery<BookingData>({
    queryKey: ["public-flexible-booking", token],
    queryFn: async () => {
      const response = await fetch(`/api/public/booking/${encodeURIComponent(token)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "We could not load these appointment choices.");
      return body;
    },
    enabled: !!token,
    retry: false,
    refetchInterval: 30_000,
  });
  const submit = useMutation({
    mutationFn: async (payload: { clinicianId: string; slotId: string; expectedSchedule?: string } | { decline: true }) => {
      const response = await fetch(`/api/public/booking/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Your response could not be saved.");
      return body as { registrationUrl?: string; declined?: boolean };
    },
    onSuccess: result => {
      if (result.registrationUrl) {
        setResumeRegistrationUrl(result.registrationUrl);
        window.location.assign(result.registrationUrl);
      }
      else setFinished(result.declined ? "declined" : "selected");
    },
    onError: error => setActionError(error.message),
  });
  const data = booking.data;
  const color = data?.primaryColor || "#54766e";

  if (booking.isLoading) return <main className="min-h-[100dvh] bg-emerald-50/40 p-6"><div className="mx-auto max-w-3xl animate-pulse space-y-5" aria-label="Loading appointment choices"><div className="h-32 rounded-xl bg-emerald-100" /><div className="h-40 rounded-xl bg-white" /><div className="h-40 rounded-xl bg-white" /></div></main>;
  if (booking.isError || !data) return <main className="min-h-[100dvh] bg-emerald-50/40 px-5 py-16"><Card className="mx-auto max-w-lg"><CardHeader><CardTitle>These choices are unavailable</CardTitle><CardDescription>{booking.error instanceof Error ? booking.error.message : "This link may have expired."} Please contact your practice for fresh choices.</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => booking.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></CardContent></Card></main>;
  if (data.status === "confirmed") return <main className="min-h-[100dvh] bg-emerald-50/40 px-5 py-16"><Card className="mx-auto max-w-lg text-center"><CardContent className="pt-9"><CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color }} /><h1 className="text-xl font-semibold">Your clinician and slot are confirmed</h1><p className="mt-2 text-muted-foreground">{data.tenantName} has recorded your booking. The practice will contact you with the next steps.</p></CardContent></Card></main>;
  if (data.status === "expired" || data.status === "unavailable") return <main className="min-h-[100dvh] bg-emerald-50/40 px-5 py-16"><Card className="mx-auto max-w-lg"><CardHeader><CardTitle>These choices are no longer available</CardTitle><CardDescription>Please contact {data.tenantName} and ask the practice to send fresh choices.</CardDescription></CardHeader></Card></main>;
  if (resumeRegistrationUrl || data.status === "selected") {
    const registrationUrl = resumeRegistrationUrl || data.registrationUrl;
    return <main className="min-h-[100dvh] bg-emerald-50/40 px-5 py-16">
      <Card className="mx-auto max-w-lg text-center">
        <CardHeader>
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10" style={{ color }} />
          <CardTitle>Your session is reserved</CardTitle>
          <CardDescription>This is a temporary reservation, not a confirmed booking. Complete registration and any required payment before the deadline shown on your registration page.</CardDescription>
        </CardHeader>
        <CardContent>
          {registrationUrl
            ? <Button asChild style={{ backgroundColor: color }}><a href={registrationUrl}>Continue to registration</a></Button>
            : <p className="text-muted-foreground">Please contact your practice for help continuing registration.</p>}
        </CardContent>
      </Card>
    </main>;
  }
  if (finished) return <main className="min-h-[100dvh] bg-emerald-50/40 px-5 py-16"><Card className="mx-auto max-w-lg text-center"><CardContent className="pt-9"><CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color }} /><h1 className="text-xl font-semibold">{finished === "declined" ? "Thank you for letting us know" : "Your clinician and slot selection has been recorded"}</h1><p className="mt-2 text-muted-foreground">{finished === "declined" ? `${data.tenantName} will be in touch to discuss other options.` : "Please contact the practice for help continuing registration and any required payment. Your booking is not confirmed until these steps are complete."}</p></CardContent></Card></main>;
  const choices = data.clinicians.flatMap(clinician => clinician.slots.map(slot => ({ clinician, slot })));
  return <main className="min-h-[100dvh] bg-[#f1f5f1] px-4 py-8 sm:py-14">
    <div className="mx-auto max-w-3xl">
      <header className="mb-7 rounded-2xl px-6 py-8 text-white shadow-sm sm:px-9" style={{ backgroundColor: color }}>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-white/75">A thoughtful next step</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{data.tenantName}</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/90">Your practice has suggested suitable clinicians for your family. Choose your preferred clinician and an available slot from the options below.</p>
      </header>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#d2ded7] bg-white/80 p-4 text-sm text-[#4c6259]">
        <Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><p>Your chosen clinician and slot will be temporarily reserved while you complete registration and any required payment. This is not yet a confirmed booking. For recurring sessions, the first session date is agreed with the practice.</p>
      </div>
      {booking.isFetching && <p className="mb-3 text-right text-xs text-muted-foreground" role="status">Checking availability…</p>}
      {actionError && <Alert variant="destructive" className="mb-4"><AlertDescription>{actionError}</AlertDescription></Alert>}
      {choices.length === 0 ? <Card><CardContent className="py-9 text-center"><UserRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h2 className="font-semibold">No current choices to show</h2><p className="mt-1 text-sm text-muted-foreground">Please contact {data.tenantName} and ask for updated appointment choices.</p><Button className="mt-4" variant="outline" onClick={() => booking.refetch()}>Refresh choices</Button></CardContent></Card> :
        <div className="space-y-4">{data.clinicians.map(clinician => <Card key={clinician.id} className="overflow-hidden border-[#d8e2dc] shadow-sm">
          <CardHeader className="pb-3"><div className="flex flex-col justify-between gap-2 sm:flex-row"><div><CardTitle className="text-lg">{clinician.name}</CardTitle>{clinician.bio && <CardDescription className="mt-2 max-w-2xl leading-relaxed">{clinician.bio}</CardDescription>}</div>{clinician.sessionRatePence != null && <span className="text-sm font-medium text-[#4c6259]">£{(clinician.sessionRatePence / 100).toFixed(2)} per session</span>}</div></CardHeader>
          <CardContent className="space-y-3">{clinician.slots.map(slot => {
            const isSelected = selected?.clinicianId === clinician.id && selected.slotId === slot.id;
            const recurring = slot.type === "Recurring";
            return <button key={slot.id} type="button" onClick={() => setSelected(isSelected ? null : { clinicianId: clinician.id, slotId: slot.id })} aria-pressed={isSelected} className={`w-full rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${isSelected ? "border-[#527467] bg-[#edf4ef] ring-1 ring-[#527467]" : "border-[#e1e8e2] bg-[#fbfcfa] hover:border-[#9db5a7]"}`}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="space-y-1.5 text-sm">
                {recurring ? <><p className="font-semibold">{formatOfferFrequency(slot.frequency)} · {slot.day || "Day to be confirmed"} · {formatOfferTimeRange(slot.startTime, slot.endTime)}</p><p className="text-muted-foreground">{formatOfferWindow(slot.startDate, slot.endDate)}</p><p className="text-muted-foreground">{FIRST_SESSION_TO_AGREE}</p><p className="text-muted-foreground">{REGULAR_SESSION_NEXT_STEPS}</p>{regularSessionConstraints(slot.startDate, slot.endDate).map(line => <p className="text-muted-foreground" key={line}>{line}</p>)}</> : <><p className="font-semibold">One-off appointment · {slot.date ? formatOfferDate(slot.date) : "Date to be confirmed"}</p><p className="text-muted-foreground">{formatOfferTimeRange(slot.startTime, slot.endTime)}</p></>}
                <p className="flex items-center gap-1.5 pt-1 text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{slot.locationType === "in_person" ? "In person" : "Online"}</p>
              </div><span className={`self-start rounded-full px-3 py-1 text-xs font-medium ${isSelected ? "bg-[#527467] text-white" : "bg-[#e8eee9] text-[#4c6259]"}`}>{isSelected ? "Slot selected" : "Choose this slot"}</span></div>
            </button>;
          })}</CardContent>
        </Card>)}</div>}
      <div className="mt-6 flex flex-col-reverse justify-between gap-3 sm:flex-row">
        <Button variant="outline" disabled={submit.isPending} onClick={() => { setActionError(""); submit.mutate({ decline: true }); }}><XCircle className="mr-2 h-4 w-4" />None of these feel right</Button>
        <Button style={{ backgroundColor: color }} disabled={!selected || submit.isPending} onClick={() => {
          if (!selected) return;
          const slot = data.clinicians.find(item => item.id === selected.clinicianId)?.slots.find(item => item.id === selected.slotId);
          if (!slot) { setActionError("This slot is no longer available. Refresh the choices and select again."); return; }
          setActionError("");
          submit.mutate({ ...selected, expectedSchedule: slotScheduleFingerprint(slot) });
        }}>{submit.isPending ? "Saving…" : "Continue with this clinician and slot"}</Button>
      </div>
      <p className="mt-7 text-center text-xs text-muted-foreground">Your practice will help you through each step.</p>
    </div>
  </main>;
}
