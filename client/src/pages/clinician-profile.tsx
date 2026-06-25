import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { MapPin, Building, Shield, User, Loader2, PoundSterling } from "lucide-react";
import type { Clinician } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useInsurers } from "@/hooks/use-insurers";

type ClinicianWithAvailability = Clinician & { availability: any[] };

export default function ClinicianProfile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: rawInsurerList = [] } = useInsurers();
  const insurerList = rawInsurerList.filter(i => i !== "Private");
  
  const { data: clinicianData, isLoading, error } = useQuery<ClinicianWithAvailability>({
    queryKey: ["/api/clinicians/me"],
    enabled: !!user,
  });

  const [formData, setFormData] = useState<any>(null);

  useEffect(() => {
    if (clinicianData) {
      setFormData({ ...clinicianData });
    }
  }, [clinicianData]);

  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<Clinician>) => {
      const response = await apiRequest("PATCH", "/api/clinicians/me", updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clinicians/me"] });
      toast({
        title: "Profile Updated",
        description: "Your professional details have been saved.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save changes. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!formData) return;
    updateMutation.mutate({
      bio: formData.bio,
      location: formData.location,
      nhsTrust: formData.nhsTrust,
      tier: formData.tier,
      insurers: formData.insurers,
      maxNewClients: formData.maxNewClients,
      worksWithCouples: formData.worksWithCouples,
      allocateForBupa: formData.allocateForBupa,
      email: formData.email,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !clinicianData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Unable to load your profile. Please try refreshing.</p>
      </div>
    );
  }

  if (!formData) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-slate-900">My Information</h1>
        <p className="text-muted-foreground mt-1">Manage your professional profile, bio, and practice details visible to admins.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-1 space-y-6">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto h-24 w-24 rounded-full bg-slate-100 flex items-center justify-center text-3xl font-bold text-slate-600 ring-4 ring-white shadow-sm mb-4">
                {formData.avatar}
              </div>
              <CardTitle>{user?.name}</CardTitle>
              <div className="flex justify-center gap-2 mt-2">
                <Badge variant="outline">{formData.tier || "Mid"}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <User className="h-4 w-4" />
                <span>{formData.specialties?.join(", ") || "No specialties set"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                <span>{formData.location || "Location not set"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Building className="h-4 w-4" />
                <span>{formData.nhsTrust || "No Trust affiliated"}</span>
              </div>
              {formData.sessionRatePence != null && (
                <div className="flex items-center gap-2 text-muted-foreground" data-testid="text-session-rate">
                  <PoundSterling className="h-4 w-4" />
                  <span>£{(formData.sessionRatePence / 100).toFixed(2)} / session</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Edit Profile Details</CardTitle>
              <CardDescription>Update your information to ensure accurate matching with clients.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Professional Bio</Label>
                <Textarea 
                  className="min-h-[120px]" 
                  value={formData.bio || ""} 
                  onChange={(e) => setFormData({...formData, bio: e.target.value})}
                />
                <p className="text-xs text-muted-foreground">This bio is visible to admins when allocating clients.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Geographical Location</Label>
                  <Input 
                    value={formData.location || ""} 
                    onChange={(e) => setFormData({...formData, location: e.target.value})}
                    placeholder="e.g. North London" 
                  />
                </div>
                <div className="space-y-2">
                  <Label>NHS Trust</Label>
                  <Input 
                    value={formData.nhsTrust || ""} 
                    onChange={(e) => setFormData({...formData, nhsTrust: e.target.value})}
                    placeholder="e.g. Tavistock" 
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Practice Tier</Label>
                <Select value={formData.tier || "Mid"} onValueChange={(v) => setFormData({...formData, tier: v})}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Mid">Mid</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Insurers Accepted</Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border p-3 rounded-md bg-slate-50/50">
                  {insurerList.map(insurer => (
                    <div key={insurer} className="flex items-center space-x-2">
                      <Checkbox 
                        id={`ins-${insurer}`} 
                        checked={formData.insurers?.includes(insurer) || false}
                        onCheckedChange={(checked) => {
                          const current = formData.insurers || [];
                          if (checked) {
                            setFormData({...formData, insurers: [...current, insurer]});
                          } else {
                            setFormData({...formData, insurers: current.filter((i: string) => i !== insurer)});
                          }
                        }}
                      />
                      <Label htmlFor={`ins-${insurer}`} className="font-normal cursor-pointer">{insurer}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input 
                  type="email"
                  value={formData.email || user?.email || ""} 
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  placeholder="your.email@example.com"
                />
                <p className="text-xs text-muted-foreground">Used for login and receiving availability reminders.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Max New Clients</Label>
                  <Input 
                    type="number" 
                    value={formData.maxNewClients || 0} 
                    onChange={(e) => setFormData({...formData, maxNewClients: parseInt(e.target.value) || 0})}
                  />
                  <p className="text-xs text-muted-foreground">Stop allocating after this many new clients.</p>
                </div>
                <div className="space-y-2 flex flex-col justify-center">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="couples" 
                      checked={formData.worksWithCouples || false}
                      onCheckedChange={(checked) => setFormData({...formData, worksWithCouples: !!checked})}
                    />
                    <Label htmlFor="couples" className="font-medium cursor-pointer">Works with Couples</Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Session Rate</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                  <Input
                    readOnly
                    disabled
                    className="pl-7 bg-slate-50 cursor-not-allowed"
                    value={formData.sessionRatePence != null ? (formData.sessionRatePence / 100).toFixed(2) : ""}
                    placeholder="Not set"
                    data-testid="input-session-rate-readonly"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Session rate is set by administrators.</p>
              </div>
            </CardContent>
            <CardFooter>
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
