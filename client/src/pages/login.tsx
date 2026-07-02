import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { requestPasswordReset } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading } = useAuth();
  const { toast } = useToast();

  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    
    if (!email || !password) {
        toast({ title: "Required fields", description: "Please enter email and password", variant: "destructive" });
        return;
    }

    const success = await login(email, password);
    if (success) {
        toast({ title: "Welcome back!", description: "Successfully logged in." });
    } else {
        toast({ title: "Login Failed", description: "Invalid email or password", variant: "destructive" });
    }
  };

  const handleOpenForgotPassword = () => {
    setResetEmail(email);
    setForgotPasswordOpen(true);
  };

  const handleSendResetLink = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!resetEmail) {
        toast({ title: "Email required", description: "Please enter your email address", variant: "destructive" });
        return;
    }

    setIsSendingReset(true);
    try {
        await requestPasswordReset(resetEmail);
        toast({
            title: "Recovery Instructions Sent",
            description: "If an account exists for this email, you will receive password reset instructions.",
        });
        setForgotPasswordOpen(false);
        setResetEmail("");
    } catch (error) {
        toast({
            title: "Something went wrong",
            description: "Could not send reset instructions. Please try again.",
            variant: "destructive",
        });
    } finally {
        setIsSendingReset(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-lg border-slate-200">
        <CardHeader className="space-y-4 items-center text-center pb-2">
           <div className="space-y-1">
             <CardTitle className="text-2xl font-serif">Practice Management Portal</CardTitle>
             <CardDescription>Enter your credentials to access the system</CardDescription>
           </div>
        </CardHeader>
        <CardContent className="space-y-4">
            <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input 
                        id="email" 
                        type="email" 
                        placeholder="name@example.com" 
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="password">Password</Label>
                        <Button 
                            variant="link" 
                            className="p-0 h-auto text-xs text-muted-foreground font-normal" 
                            type="button"
                            data-testid="button-forgot-password"
                            onClick={handleOpenForgotPassword}
                        >
                            Forgot password?
                        </Button>
                    </div>
                    <Input 
                        id="password" 
                        type="password" 
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </div>
                <Button className="w-full" type="submit" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Sign In
                </Button>
            </form>

        </CardContent>
        <CardFooter className="flex justify-center text-xs text-muted-foreground">
            Protected Client Management System
        </CardFooter>
      </Card>

      <Dialog open={forgotPasswordOpen} onOpenChange={setForgotPasswordOpen}>
        <DialogContent>
          <form onSubmit={handleSendResetLink}>
            <DialogHeader>
              <DialogTitle>Reset your password</DialogTitle>
              <DialogDescription>
                Enter your email address and we'll send you a link to reset your password.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="reset-email">Email Address</Label>
              <Input
                id="reset-email"
                type="email"
                placeholder="name@example.com"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                data-testid="input-reset-email"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setForgotPasswordOpen(false)}
                data-testid="button-cancel-reset"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSendingReset} data-testid="button-send-reset">
                {isSendingReset ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Send Reset Link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
