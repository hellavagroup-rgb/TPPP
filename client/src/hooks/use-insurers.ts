import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function useInsurers() {
  return useQuery<string[]>({
    queryKey: ["/api/insurers"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useManagedInsurers() {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/insurers/managed"],
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddInsurer() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/insurers", { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insurers/managed"] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "Please try again.";
      toast({
        title: "Failed to add insurer",
        description: message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteInsurer() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/insurers/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/insurers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/insurers/managed"] });
      toast({ title: "Insurer removed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to remove insurer.", variant: "destructive" });
    },
  });
}
