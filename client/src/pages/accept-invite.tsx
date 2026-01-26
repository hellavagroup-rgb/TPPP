import { useState, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from "lucide-react";
import logo from "@assets/xPerinatalPP-logo-large-digital.png.pagespeed.ic.wAjk_RUOnf_1766008188694.png";

interface InviteInfo {
  valid: boolean;
  name?: string;
  email?: string;
  error?: string;
}

export default function AcceptInvite() {
  const [, setLocation] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);

  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get("token");

  useEffect(() => {
    if (!token) {
      setInviteInfo({ valid: false, error: "No invite token provided" });
      setIsLoading(false);
      return;
    }

    fetch(`/api/admin-users/invite/${token}`)
      .then(res => res.json())
      .then(data => {
        setInviteInfo(data);
        setIsLoading(false);
      })
      .catch(() => {
        setInviteInfo({ valid: false, error: "Failed to validate invite" });
        setIsLoading(false);
      });
  }, [token]);

  const validatePassword = (pwd: string): string[] => {
    const errors: string[] = [];
    if (pwd.length < 8) errors.push("at least 8 characters");
    if (!/[A-Z]/.test(pwd)) errors.push("one uppercase letter");
    if (!/[a-z]/.test(pwd)) errors.push("one lowercase letter");
    if (!/[0-9]/.test(pwd)) errors.push("one number");
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(pwd)) errors.push("one special character");
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password || !confirmPassword) {
      toast.error("Please fill in both password fields");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      toast.error(`Password must contain: ${passwordErrors.join(", ")}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin-users/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to activate account");
        return;
      }

      setIsComplete(true);
      toast.success("Account activated! Redirecting to login...");
      setTimeout(() => setLocation("/login"), 2000);
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md shadow-lg border-slate-200">
          <CardContent className="py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-4 text-muted-foreground">Validating invite...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!inviteInfo?.valid) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md shadow-lg border-slate-200">
          <CardHeader className="space-y-4 items-center text-center pb-2">
            <img src={logo} alt="The Perinatal Psychology Practice" className="w-48 object-contain mb-2" />
          </CardHeader>
          <CardContent className="py-8 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h2 className="text-xl font-semibold mb-2">Invalid Invite</h2>
            <p className="text-muted-foreground">{inviteInfo?.error || "This invite link is invalid or has expired."}</p>
          </CardContent>
          <CardFooter className="justify-center">
            <Button onClick={() => setLocation("/login")} data-testid="button-go-to-login">
              Go to Login
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
        <Card className="w-full max-w-md shadow-lg border-slate-200">
          <CardHeader className="space-y-4 items-center text-center pb-2">
            <img src={logo} alt="The Perinatal Psychology Practice" className="w-48 object-contain mb-2" />
          </CardHeader>
          <CardContent className="py-8 text-center">
            <CheckCircle className="h-12 w-12 mx-auto text-green-600 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Account Activated!</h2>
            <p className="text-muted-foreground">Redirecting you to login...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-lg border-slate-200">
        <CardHeader className="space-y-4 items-center text-center pb-2">
          <img src={logo} alt="The Perinatal Psychology Practice" className="w-48 object-contain mb-2" />
          <div className="space-y-1">
            <CardTitle className="text-2xl font-serif">Set Up Your Account</CardTitle>
            <CardDescription>
              Welcome, {inviteInfo.name}! Create a password to activate your admin account.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input 
                id="email" 
                type="email" 
                value={inviteInfo.email || ""}
                disabled
                className="bg-muted"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input 
                  id="password" 
                  type={showPassword ? "text" : "password"} 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a secure password"
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {password.length > 0 && (
                <div className="space-y-1">
                  <p className={`text-xs ${password.length >= 8 ? "text-green-600" : "text-red-600"}`}>
                    {password.length >= 8 ? "✓" : "✗"} At least 8 characters
                  </p>
                  <p className={`text-xs ${/[A-Z]/.test(password) ? "text-green-600" : "text-red-600"}`}>
                    {/[A-Z]/.test(password) ? "✓" : "✗"} One uppercase letter
                  </p>
                  <p className={`text-xs ${/[a-z]/.test(password) ? "text-green-600" : "text-red-600"}`}>
                    {/[a-z]/.test(password) ? "✓" : "✗"} One lowercase letter
                  </p>
                  <p className={`text-xs ${/[0-9]/.test(password) ? "text-green-600" : "text-red-600"}`}>
                    {/[0-9]/.test(password) ? "✓" : "✗"} One number
                  </p>
                  <p className={`text-xs ${/[!@#$%^&*(),.?":{}|<>]/.test(password) ? "text-green-600" : "text-red-600"}`}>
                    {/[!@#$%^&*(),.?":{}|<>]/.test(password) ? "✓" : "✗"} One special character
                  </p>
                </div>
              )}
              {password.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Must be at least 8 characters with uppercase, lowercase, number, and special character.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input 
                id="confirm-password" 
                type="password" 
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                data-testid="input-confirm-password"
              />
            </div>
            <Button className="w-full" type="submit" disabled={isSubmitting} data-testid="button-activate">
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Activate Account
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex justify-center text-xs text-muted-foreground">
          The Perinatal Psychology Practice
        </CardFooter>
      </Card>
    </div>
  );
}
