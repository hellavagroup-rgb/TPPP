import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import { useToast } from "@/hooks/use-toast";
import type { ReactNode } from "react";

// Hook to fetch and manage all application data with real API calls
export function useAppData() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ============ CLINICIANS ============
  const { data: clinicians = [] } = useQuery({
    queryKey: ["clinicians"],
    queryFn: api.getClinicians,
  });

  const updateClinicianAvailabilityMutation = useMutation({
    mutationFn: ({ clinicianId, slots }: { clinicianId: string; slots: any[] }) =>
      api.updateTimeSlots(clinicianId, slots),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clinicians"] });
    },
  });

  // ============ CLIENTS ============
  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: api.getClients,
  });

  const createClientMutation = useMutation({
    mutationFn: api.createClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      toast({ title: "Client created successfully" });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) =>
      api.updateClient(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const assignClinicianMutation = useMutation({
    mutationFn: ({ clientId, clinicianId, slotId }: { clientId: string; clinicianId: string; slotId: string }) =>
      api.assignClinician(clientId, clinicianId, slotId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["clinicians"] });
      toast({ title: "Clinician assigned successfully" });
    },
  });

  // ============ FORMS ============
  const { data: forms = [] } = useQuery({
    queryKey: ["forms"],
    queryFn: api.getForms,
  });

  const createFormMutation = useMutation({
    mutationFn: api.createForm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms"] });
      toast({ title: "Form created successfully" });
    },
  });

  const updateFormMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) =>
      api.updateForm(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms"] });
      toast({ title: "Form updated successfully" });
    },
  });

  const deleteFormMutation = useMutation({
    mutationFn: api.deleteForm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["forms"] });
      toast({ title: "Form deleted successfully" });
    },
  });

  // ============ TASKS ============
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks"],
    queryFn: api.getTasks,
  });

  const createTaskMutation = useMutation({
    mutationFn: api.createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast({ title: "Task created successfully" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) =>
      api.updateTask(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return {
    // Data
    clinicians,
    clients,
    forms,
    tasks,
    // Mutations
    addClient: createClientMutation.mutate,
    updateClientStatus: (id: string, status: any) => 
      updateClientMutation.mutate({ id, updates: { status } }),
    assignClinician: (clientId: string, clinicianId: string, slotId: string) =>
      assignClinicianMutation.mutate({ clientId, clinicianId, slotId }),
    updateClinicianAvailability: (clinicianId: string, slots: any[]) =>
      updateClinicianAvailabilityMutation.mutate({ clinicianId, slots }),
    addForm: createFormMutation.mutate,
    updateForm: (id: string, updates: any) => 
      updateFormMutation.mutate({ id, updates }),
    deleteForm: deleteFormMutation.mutate,
    addTask: createTaskMutation.mutate,
    updateTaskStatus: (id: string, status: any) =>
      updateTaskMutation.mutate({ id, updates: { status } }),
    // Mock notifications - these would come from a real notifications API
    notifications: [],
    addNotification: () => {},
    markNotificationRead: () => {},
  };
}

// Dummy provider for backward compatibility
export function DataProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
