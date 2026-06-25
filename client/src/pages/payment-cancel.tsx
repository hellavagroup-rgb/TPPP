import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function PaymentCancel() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
      <XCircle className="h-16 w-16 text-red-400 mb-6" />
      <h1 className="text-3xl font-serif font-bold mb-3">Payment Cancelled</h1>
      <p className="text-muted-foreground mb-8 max-w-sm">
        Your payment was not completed. Please contact the practice if you need assistance.
      </p>
      <Button variant="outline" onClick={() => setLocation("/")}>
        Return to home
      </Button>
    </div>
  );
}
