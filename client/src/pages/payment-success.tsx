import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function PaymentSuccess() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
      <CheckCircle2 className="h-16 w-16 text-green-500 mb-6" />
      <h1 className="text-3xl font-serif font-bold mb-3">Payment Successful</h1>
      <p className="text-muted-foreground mb-2 max-w-sm">
        Thank you — your card has been saved and your initial session payment has been processed.
      </p>
      <p className="text-sm text-muted-foreground mb-8 max-w-sm">
        Your therapist will be in touch to confirm your appointment details.
      </p>
      <Button variant="outline" onClick={() => setLocation("/")}>
        Return to home
      </Button>
    </div>
  );
}
