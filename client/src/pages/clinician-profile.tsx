import { useData } from "@/lib/mockData";
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
import { MapPin, Building, Shield, User } from "lucide-react";

const INSURERS = ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA", "Other"];

export default function ClinicianProfile() {
  const { user } = useAuth();
  const { clinicians } = useData();
  const { toast } = useToast();
  
  // Find the actual clinician object
  const currentClinician = clinicians.find(c => c.id === user?.id);
  
  // Local state for editing
  const [formData, setFormData] = useState<any>(null);

  useEffect(() => {
    if (currentClinician) {
        setFormData({ ...currentClinician });
    }
  }, [currentClinician]);

  const handleSave = () => {
    // In a real app, we'd call updateClinician(formData)
    toast({
        title: "Profile Updated",
        description: "Your professional details have been saved.",
    });
  };

  if (!currentClinician || !formData) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-slate-900">My Information</h1>
        <p className="text-muted-foreground mt-1">Manage your professional profile, bio, and practice details visible to admins.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Profile Summary Card */}
        <div className="md:col-span-1 space-y-6">
            <Card>
                <CardHeader className="text-center">
                    <div className="mx-auto h-24 w-24 rounded-full bg-slate-100 flex items-center justify-center text-3xl font-bold text-slate-600 ring-4 ring-white shadow-sm mb-4">
                        {formData.avatar}
                    </div>
                    <CardTitle>{formData.name}</CardTitle>
                    <div className="flex justify-center gap-2 mt-2">
                        <Badge variant="outline">{formData.tier || "Associate"}</Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-4 w-4" />
                        <span>{formData.specialties.join(", ")}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        <span>{formData.location || "Location not set"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <Building className="h-4 w-4" />
                        <span>{formData.nhsTrust || "No Trust affiliated"}</span>
                    </div>
                </CardContent>
            </Card>
        </div>

        {/* Edit Form */}
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
                            value={formData.bio} 
                            onChange={(e) => setFormData({...formData, bio: e.target.value})}
                        />
                        <p className="text-xs text-muted-foreground">This bio is visible to admins when allocating clients.</p>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Geographical Location</Label>
                            <Input 
                                value={formData.location} 
                                onChange={(e) => setFormData({...formData, location: e.target.value})}
                                placeholder="e.g. North London" 
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>NHS Trust Affiliation</Label>
                            <Input 
                                value={formData.nhsTrust} 
                                onChange={(e) => setFormData({...formData, nhsTrust: e.target.value})}
                                placeholder="e.g. Tavistock" 
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label>Insurance Panels</Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 border p-4 rounded-md bg-slate-50/50">
                            {INSURERS.map(insurer => (
                                <div key={insurer} className="flex items-center space-x-2">
                                    <Checkbox 
                                        id={`ins-${insurer}`} 
                                        checked={formData.insurers?.includes(insurer)}
                                        onCheckedChange={(checked) => {
                                            const current = formData.insurers || [];
                                            const updated = checked 
                                                ? [...current, insurer]
                                                : current.filter((i: string) => i !== insurer);
                                            setFormData({...formData, insurers: updated});
                                        }}
                                    />
                                    <Label htmlFor={`ins-${insurer}`} className="font-normal cursor-pointer">{insurer}</Label>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-4 border p-4 rounded-md">
                            <div className="space-y-2">
                                <Label>New Client Capacity (Monthly)</Label>
                                <Input 
                                    type="number" 
                                    value={formData.maxNewClients} 
                                    onChange={(e) => setFormData({...formData, maxNewClients: parseInt(e.target.value)})}
                                />
                            </div>
                        </div>
                        <div className="space-y-4 border p-4 rounded-md flex flex-col justify-center">
                            <div className="flex items-center space-x-2">
                                <Checkbox 
                                    id="couples" 
                                    checked={formData.worksWithCouples} 
                                    onCheckedChange={(c) => setFormData({...formData, worksWithCouples: !!c})}
                                />
                                <Label htmlFor="couples" className="font-medium cursor-pointer">Works with Couples</Label>
                            </div>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-2 border-t pt-6 bg-slate-50/50">
                    <Button onClick={handleSave}>Save Changes</Button>
                </CardFooter>
            </Card>
        </div>
      </div>
    </div>
  );
}
