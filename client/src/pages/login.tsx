import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/lib/mockData";
import { Loader2, Shield, Stethoscope, ArrowRight } from "lucide-react";
import logo from "@assets/xPerinatalPP-logo-large-digital.png.pagespeed.ic.wAjk_RUOnf_1766008188694.png";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading } = useAuth();
  const { toast } = useToast();
  const { clinicians } = useData();

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email) {
        toast({ title: "Email required", variant: "destructive" });
        return;
    }

    const success = await login(email);
    if (success) {
        toast({ title: "Welcome back!", description: "Successfully logged in." });
    } else {
        toast({ title: "Login Failed", description: "Invalid credentials. Try admin@perinatalpsych.com", variant: "destructive" });
    }
  };

  const handleTestLogin = (role: "admin" | "clinician", emailValue: string) => {
    setEmail(emailValue);
    setPassword("password123"); // Dummy fill
    login(emailValue);
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

            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Test Mode</span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
                <Button variant="outline" className="justify-start h-auto py-3" onClick={() => handleTestLogin("admin", "admin@perinatalpsych.com")}>
                    <Shield className="h-5 w-5 mr-3 text-indigo-600" />
                    <div className="flex flex-col items-start">
                        <span className="font-medium text-sm">Admin Access</span>
                        <span className="text-[10px] text-muted-foreground">View all clients & settings</span>
                    </div>
                    <ArrowRight className="ml-auto h-4 w-4 text-slate-300" />
                </Button>
                
                <p className="text-xs text-muted-foreground font-medium mt-1 mb-1">Clinician Access:</p>
                {clinicians.slice(0, 2).map(c => (
                    <Button key={c.id} variant="outline" className="justify-start h-auto py-3" onClick={() => handleTestLogin("clinician", `${c.name.split(' ')[1].toLowerCase()}@perinatalpsych.com`)}>
                        <Stethoscope className="h-5 w-5 mr-3 text-emerald-600" />
                        <div className="flex flex-col items-start">
                            <span className="font-medium text-sm">{c.name}</span>
                            <span className="text-[10px] text-muted-foreground">View only own schedule</span>
                        </div>
                        <ArrowRight className="ml-auto h-4 w-4 text-slate-300" />
                    </Button>
                ))}
            </div>
        </CardContent>
        <CardFooter className="flex justify-center text-xs text-muted-foreground">
            Protected Client Management System
        </CardFooter>
      </Card>
    </div>
  );
}
