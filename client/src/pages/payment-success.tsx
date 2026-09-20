import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import {
  nextPaymentReturnCheck,
  PAYMENT_RETURN_POLL_INTERVAL_MS,
} from "@/lib/paymentReturnPolling";

type ReturnStatus = "invalid" | "processing" | "confirmed" | "paid" | "incomplete" | "failed" | "timed_out";
type ReturnResponse = {
  status: Exclude<ReturnStatus, "timed_out">;
  practice?: { name: string; logoUrl: string | null; primaryColor: string | null };
};

export default function PaymentSuccess() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<ReturnStatus>("processing");
  const [practice, setPractice] = useState<ReturnResponse["practice"]>();
  const [attempt, setAttempt] = useState(0);
  const sessionId = new URLSearchParams(window.location.search).get("session_id");

  const retry = useCallback(() => {
    setStatus("processing");
    setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setStatus("invalid");
      return;
    }
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const response = await fetch(`/api/public/payment-return?session_id=${encodeURIComponent(sessionId)}`, {
          signal: controller.signal,
          credentials: "omit",
        });
        if (!response.ok) throw new Error("Verification unavailable");
        const result = await response.json() as ReturnResponse;
        if (result.practice) setPractice(result.practice);
        const next = nextPaymentReturnCheck({
          status: result.status,
          elapsedMs: Date.now() - startedAt,
        });
        if (next === "stop") {
          setStatus(result.status);
          return;
        }
        if (next === "timeout") {
          setStatus("timed_out");
          return;
        }
        setStatus("processing");
        timer = setTimeout(check, PAYMENT_RETURN_POLL_INTERVAL_MS);
      } catch (error) {
        if (!controller.signal.aborted) setStatus("failed");
      }
    };
    void check();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, attempt]);

  const color = practice?.primaryColor || "#16a34a";
  const content = {
    confirmed: {
      icon: <CheckCircle2 className="h-16 w-16 mb-6" style={{ color }} />,
      title: "Payment confirmed",
      body: "Your payment has been verified and your appointment is confirmed.",
    },
    paid: {
      icon: <CheckCircle2 className="h-16 w-16 mb-6" style={{ color }} />,
      title: "Payment successful",
      body: "Your payment has been verified. The practice will contact you about any booking or next steps.",
    },
    processing: {
      icon: <LoaderCircle className="h-16 w-16 mb-6 animate-spin" style={{ color }} />,
      title: "Confirming your booking",
      body: "Your payment was received. We’re waiting for the practice’s booking system to finish confirming your appointment.",
    },
    incomplete: {
      icon: <Clock3 className="h-16 w-16 text-amber-500 mb-6" />,
      title: "Payment not completed",
      body: "We could not verify a completed payment. Your appointment has not been confirmed. Please return to your payment link or contact the practice.",
    },
    timed_out: {
      icon: <Clock3 className="h-16 w-16 text-amber-500 mb-6" />,
      title: "Confirmation is taking longer",
      body: "Your payment may still be processing, but your appointment is not confirmed yet. You can check again now or contact the practice.",
    },
    failed: {
      icon: <AlertCircle className="h-16 w-16 text-destructive mb-6" />,
      title: "We can’t verify your payment",
      body: "Your appointment is not confirmed yet. Please try again or contact the practice if this continues.",
    },
    invalid: {
      icon: <AlertCircle className="h-16 w-16 text-muted-foreground mb-6" />,
      title: "This payment link can’t be verified",
      body: "For your privacy, no booking details are available. Please use the original payment link or contact the practice.",
    },
  }[status];

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
      {practice?.logoUrl && (
        <img src={practice.logoUrl} alt={practice.name} className="max-h-16 max-w-48 object-contain mb-6" />
      )}
      {content.icon}
      <h1 className="text-3xl font-serif font-bold mb-3">{content.title}</h1>
      {practice?.name && <p className="font-medium mb-2">{practice.name}</p>}
      <p className="text-muted-foreground mb-8 max-w-md">{content.body}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {["timed_out", "failed"].includes(status) && (
          <Button onClick={retry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Check again
          </Button>
        )}
        <Button variant="outline" onClick={() => setLocation("/")}>Return to home</Button>
      </div>
    </div>
  );
}
