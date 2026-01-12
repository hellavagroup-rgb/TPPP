import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import logo from "@assets/xPerinatalPP-logo-large-digital.png.pagespeed.ic.wAjk_RUOnf_1766008188694.png";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading } = useAuth();
  const { toast } = useToast();

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
  
  const handleForgotPassword = () => {
    toast({
        title: "Recovery Instructions Sent",
        description: "If an account exists for this email, you will receive password reset instructions.",
    });
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4">
      <Card className="w-full max-w-md shadow-lg border-slate-200">
        <CardHeader className="space-y-4 items-center text-center pb-2">
           <img src={logo} alt="The Perinatal Psychology Practice" className="w-48 object-contain mb-2" />
           <div className="space-y-1">
             <CardTitle className="text-2xl font-serif">Portal Login</CardTitle>
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
                        placeholder="name@perinatalpsych.com" 
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
                            onClick={handleForgotPassword}
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
    </div>
  );
}
