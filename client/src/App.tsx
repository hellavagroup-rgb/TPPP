import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import Tasks from "@/pages/tasks";
import Waitlist from "@/pages/waitlist";
import Settings from "@/pages/settings";
import Availability from "@/pages/availability";
import Forms from "@/pages/forms";
import FormBuilder from "@/pages/form-builder";
import FormFill from "@/pages/form-fill";
import Analytics from "@/pages/analytics";
import Clinicians from "@/pages/clinicians";
import IntakeInbox from "@/pages/intake-inbox";
import Layout from "@/components/layout";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/pages/login";
import ClinicianProfile from "@/pages/clinician-profile";
import AcceptInvite from "@/pages/accept-invite";
import ResetPassword from "@/pages/reset-password";
import PaymentSuccess from "@/pages/payment-success";
import PaymentCancel from "@/pages/payment-cancel";
import Payments from "@/pages/payments";
import SuperAdmin from "@/pages/super-admin";
import OptionSelection from "@/pages/option-selection";
import RegistrationForm from "@/pages/registration-form";
import { useEffect } from "react";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return null;

  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation("/login");
    } else if (!isLoading && user && user.role !== "admin") {
      setLocation("/");
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user || user.role !== "admin") return null;

  return <Component />;
}

function Router() {
  const [location] = useLocation();
  
  // Public Routes (Login, Form Fill, Payment pages)
  if (location.startsWith("/fill")) {
      return (
        <Switch>
            <Route path="/fill/:clientId/:formId" component={FormFill} />
        </Switch>
      );
  }

  if (location === "/login") {
      return <Login />;
  }

  if (location.startsWith("/accept-invite")) {
      return <AcceptInvite />;
  }

  if (location.startsWith("/reset-password")) {
      return <ResetPassword />;
  }

  if (location.startsWith("/payment-success")) {
      return <PaymentSuccess />;
  }

  if (location.startsWith("/payment-cancel")) {
      return <PaymentCancel />;
  }

  if (location.startsWith("/options/")) {
      return (
        <Switch>
          <Route path="/options/:selectionToken" component={OptionSelection} />
        </Switch>
      );
  }

  if (location.startsWith("/register/")) {
      return (
        <Switch>
          <Route path="/register/:clientId/:registrationToken" component={RegistrationForm} />
        </Switch>
      );
  }

  if (location.toLowerCase().startsWith("/super-admin")) {
      return <SuperAdmin />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={() => <ProtectedRoute component={Dashboard} />} />
        <Route path="/clients" component={() => <ProtectedRoute component={Clients} />} />
        <Route path="/tasks" component={() => <ProtectedRoute component={Tasks} />} />
        <Route path="/clinicians" component={() => <ProtectedRoute component={Clinicians} />} />
        <Route path="/waitlist" component={() => <ProtectedRoute component={Waitlist} />} />
        <Route path="/settings" component={() => <ProtectedRoute component={Settings} />} />
        <Route path="/availability" component={() => <ProtectedRoute component={Availability} />} />
        <Route path="/forms" component={() => <ProtectedRoute component={Forms} />} />
        <Route path="/forms/:id" component={() => <ProtectedRoute component={FormBuilder} />} />
        <Route path="/analytics" component={() => <ProtectedRoute component={Analytics} />} />
        <Route path="/payments" component={() => <AdminRoute component={Payments} />} />
        <Route path="/intake-inbox" component={() => <ProtectedRoute component={IntakeInbox} />} />
        
        {/* Clinician Routes */}
        <Route path="/clinician-profile" component={() => <ProtectedRoute component={ClinicianProfile} />} />
        
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
          <Router />
          <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
