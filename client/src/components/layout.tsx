import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Users, 
  ClipboardList, 
  CalendarClock, 
  Settings, 
  LogOut,
  Bell,
  Search,
  Menu
} from "lucide-react";
import logo from "@assets/xPerinatalPP-logo-large-digital.png.pagespeed.ic.wAjk_RUOnf_1766008188694.png";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Clients", href: "/clients", icon: Users },
    { name: "Waitlist", href: "/waitlist", icon: CalendarClock },
    { name: "Tasks", href: "/tasks", icon: ClipboardList },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  const SidebarContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className="p-6 flex flex-col gap-4">
        <div className="w-full flex justify-center py-2">
             {/* Logo is wide, so we display it without a constraining circle */}
             <img src={logo} alt="The Perinatal Psychology Practice" className="w-full max-w-[200px] object-contain" />
        </div>
      </div>

      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-sidebar-foreground/50" />
          <Input 
            placeholder="Search clients..." 
            className="pl-9 bg-sidebar-accent/50 border-sidebar-border text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus-visible:ring-sidebar-ring"
          />
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
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
          <Avatar className="h-9 w-9 border border-sidebar-border">
            <AvatarImage src="https://github.com/shadcn.png" />
            <AvatarFallback>AD</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">Admin User</p>
            <p className="text-xs text-sidebar-foreground/60 truncate">admin@perinatalpsych.com</p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex md:w-64 md:flex-col fixed inset-y-0 z-50">
        <SidebarContent />
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
        <SheetContent side="left" className="p-0 w-64 bg-sidebar border-r border-sidebar-border">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
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
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-card" />
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-auto">
          <div className="max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
