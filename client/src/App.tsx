import { Switch, Route, useRoute } from "wouter";
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
import Layout from "@/components/layout";
import { DataProvider } from "@/lib/mockData";

function Router() {
  const [location] = useRoute("/fill/:clientId/:formId");
  
  // If we are on the fill page, don't use the main admin layout
  if (location) {
      return (
        <Switch>
            <Route path="/fill/:clientId/:formId" component={FormFill} />
        </Switch>
      );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/clients" component={Clients} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/waitlist" component={Waitlist} />
        <Route path="/settings" component={Settings} />
        <Route path="/availability" component={Availability} />
        <Route path="/forms" component={Forms} />
        <Route path="/forms/:id" component={FormBuilder} />
        <Route path="/analytics" component={Analytics} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DataProvider>
        <Router />
        <Toaster />
      </DataProvider>
    </QueryClientProvider>
  );
}

export default App;
