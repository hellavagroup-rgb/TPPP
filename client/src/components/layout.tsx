import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useData } from "@/lib/mockData";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { 
  LayoutDashboard, 
  Users, 
  ClipboardList, 
  CalendarClock, 
  Settings, 
  LogOut,
  Bell,
  Search,
  Menu,
  FileText,
  BarChart3,
  Brain,
  UserCircle,
  KeyRound,
  Inbox,
  CreditCard
} from "lucide-react";
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

function hexToHsl(hex: string): string | null {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const { notifications } = useData();
  const { user, logout } = useAuth();

  const { data: tenant } = useQuery({
    queryKey: ["/api/tenant"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tenant");
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  useEffect(() => {
    const root = document.documentElement;
    const primary = tenant?.primaryColor ? hexToHsl(tenant.primaryColor) : null;
    const accent = tenant?.accentColor ? hexToHsl(tenant.accentColor) : null;
    if (primary) {
      root.style.setProperty("--primary", primary);
      root.style.setProperty("--sidebar-primary", primary);
      root.style.setProperty("--ring", primary);
      root.style.setProperty("--sidebar-ring", primary);
      root.style.setProperty("--chart-1", primary);
    }
    if (accent) {
      root.style.setProperty("--accent-brand", accent);
    }
  }, [tenant?.primaryColor, tenant?.accentColor]);

  const { toast } = useToast();
  
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChanging, setIsChanging] = useState(false);

  const unreadNotifications = notifications.filter(n => !n.read).length;

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "Error", description: "Please fill in all fields.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Error", description: "New password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Error", description: "New passwords do not match.", variant: "destructive" });
      return;
    }
    setIsChanging(true);
    try {
      const res = await apiRequest("POST", "/api/auth/change-password", {
        currentPassword,
        newPassword,
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Error", description: data.error || "Failed to change password.", variant: "destructive" });
        return;
      }
      toast({ title: "Password Changed", description: "Your password has been updated successfully." });
      setIsChangePasswordOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to change password.", variant: "destructive" });
    } finally {
      setIsChanging(false);
    }
  };

  const adminNavigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Clients", href: "/clients", icon: Users },
    ...(tenant?.waitlistEnabled !== false ? [{ name: "Waitlist", href: "/waitlist", icon: CalendarClock }] : []),
    ...(tenant?.tasksEnabled !== false ? [{ name: "Tasks", href: "/tasks", icon: ClipboardList }] : []),
    { name: "Clinicians", href: "/clinicians", icon: Brain },
    { name: "Availability", href: "/availability", icon: CalendarClock },
    ...(tenant?.formsEnabled !== false ? [{ name: "Forms", href: "/forms", icon: FileText }] : []),
    ...(tenant?.analyticsEnabled !== false ? [{ name: "Analytics", href: "/analytics", icon: BarChart3 }] : []),
    ...(tenant?.paymentsEnabled !== false ? [{ name: "Payments", href: "/payments", icon: CreditCard }] : []),
    ...(tenant?.gmailIntakeEnabled ? [{ name: "Intake Inbox", href: "/intake-inbox", icon: Inbox }] : []),
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  const clinicianNavigation = [
    { name: "Information", href: "/clinician-profile", icon: UserCircle },
    { name: "Availability", href: "/availability", icon: CalendarClock },
  ];

  const navigation = user?.role === "clinician" ? clinicianNavigation : adminNavigation;

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <div className="w-full flex flex-col items-center gap-1">
             {tenant?.logoUrl ? (
               <img src={tenant.logoUrl} alt={tenant.name || "Practice"} className="max-h-[64px] max-w-[148px] w-auto object-contain" />
             ) : (
               <span className="text-base font-semibold text-sidebar-foreground text-center leading-tight">
                 {tenant?.name || "Practice Portal"}
               </span>
             )}
             <span className="text-[10px] uppercase tracking-widest text-sidebar-foreground/60 font-medium">
                {user?.role === "clinician" ? "Clinician Portal" : "Client Management"}
             </span>
        </div>
      </div>

      <div className="px-3 py-2 flex-shrink-0">
        {user?.role === "admin" && (
            <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-sidebar-foreground/50" />
            <Input 
                placeholder="Search clients..." 
                className="pl-9 bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus-visible:ring-sidebar-ring"
            />
            </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {navigation.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href}>
              <div
                className={cn(
                  "group flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-all duration-200 cursor-pointer",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
                onClick={() => setIsMobileOpen(false)}
              >
                <item.icon
                  className={cn(
                    "mr-3 h-5 w-5 flex-shrink-0 transition-colors",
                    isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground"
                  )}
                />
                {item.name}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground">
            <AvatarFallback>{user?.avatar || "U"}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name || "Guest"}</p>
            <p className="text-xs text-sidebar-foreground/60 truncate capitalize">{user?.role || "Visitor"}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => setIsChangePasswordOpen(true)}
            title="Change Password"
            data-testid="button-change-password"
          >
            <KeyRound className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={logout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      <div className="hidden md:flex md:w-64 md:flex-col fixed inset-y-0 z-50">
        <SidebarContent />
      </div>

      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="left" className="p-0 w-64 bg-sidebar border-r border-sidebar-border">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="flex-1 md:pl-64 flex flex-col">
        <header className="h-16 flex items-center justify-between px-6 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-40">
          <div className="flex items-center gap-4 md:hidden">
            <Button variant="ghost" size="icon" className="-ml-2" onClick={() => setIsMobileOpen(true)}>
                <Menu className="h-5 w-5" />
            </Button>
          </div>
          
          <div className="flex-1"></div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground">
              <Bell className="h-5 w-5" />
              {unreadNotifications > 0 && (
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
              )}
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </main>
      </div>

      <Dialog open={isChangePasswordOpen} onOpenChange={(open) => {
        setIsChangePasswordOpen(open);
        if (!open) {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        }
      }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              Change Password
            </DialogTitle>
            <DialogDescription>
              Enter your current password and choose a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Current Password</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                data-testid="input-current-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm New Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                data-testid="input-confirm-password"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setIsChangePasswordOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleChangePassword}
              disabled={isChanging}
              data-testid="button-submit-change-password"
            >
              {isChanging ? "Changing..." : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
