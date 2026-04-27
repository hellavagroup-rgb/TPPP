import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function useInsurers() {
  return useQuery<string[]>({
    queryKey: ["/api/insurers"],
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
