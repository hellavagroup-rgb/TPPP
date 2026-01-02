import { useData, Clinician } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MapPin, Building, Users, Shield, Edit, Briefcase, Stethoscope, Star } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const INSURERS = ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA", "Other"];

export default function Clinicians() {
  const { clinicians } = useData(); // In a real app we'd need an updateClinician function
  const [selectedClinician, setSelectedClinician] = useState<Clinician | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { toast } = useToast();

  const handleEditClick = (clinician: Clinician) => {
    setSelectedClinician(clinician);
    setIsEditOpen(true);
  };

  const handleSave = () => {
    // Mock save functionality
    setIsEditOpen(false);
    toast({
        title: "Clinician Updated",
        description: "Clinician profile has been successfully updated.",
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-serif font-bold text-slate-900">Clinician Directory</h1>
        <p className="text-muted-foreground mt-1">Manage clinician profiles, insurance panels, and practice tiers.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {clinicians.map((clinician) => (
          <Card key={clinician.id} className="overflow-hidden border-none shadow-sm hover:shadow-md transition-all group h-full flex flex-col">
            <CardHeader className="relative pb-0 pt-6 px-6">
                <div className="flex items-start justify-between">
                    <div className="flex gap-4">
                        <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-lg font-bold text-slate-600 ring-2 ring-white shadow-sm">
                            {clinician.avatar}
                        </div>
                        <div>
                            <CardTitle className="text-lg font-serif">{clinician.name}</CardTitle>
                            <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className="text-[10px] font-normal border-slate-200">
                                    {clinician.tier || "Associate"}
                                </Badge>
                                {clinician.worksWithCouples && (
                                    <Badge variant="secondary" className="text-[10px] font-normal bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                                        Couples
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-slate-900" onClick={() => handleEditClick(clinician)}>
                        <Edit className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            
            <CardContent className="p-6 space-y-4 flex-grow">
                {clinician.bio && (
                    <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                        {clinician.bio}
                    </p>
                )}
                
                <div className="space-y-3 pt-2">
                    <div className="flex items-start gap-3 text-sm">
                        <MapPin className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                            <span className="font-medium block text-slate-700">Location</span>
                            <span className="text-slate-500">{clinician.location || "Not specified"}</span>
                        </div>
                    </div>
                    
                    <div className="flex items-start gap-3 text-sm">
                        <Building className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                            <span className="font-medium block text-slate-700">NHS Trust</span>
                            <span className="text-slate-500">{clinician.nhsTrust || "Not specified"}</span>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 text-sm">
                        <Shield className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                        <div>
                            <span className="font-medium block text-slate-700">Insurers</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {clinician.insurers?.map(insurer => (
                                    <span key={insurer} className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100">
                                        {insurer}
                                    </span>
                                ))}
                                {(!clinician.insurers || clinician.insurers.length === 0) && (
                                    <span className="text-slate-400 italic">None listed</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>

            <CardFooter className="bg-slate-50/50 p-4 border-t border-slate-100 text-xs text-muted-foreground flex justify-between">
                <div className="flex items-center gap-1.5" title="Max New Clients">
                    <Users className="h-3.5 w-3.5" />
                    <span>Cap: {clinician.maxNewClients || 0} New</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span>Load: {clinician.currentLoad}/{clinician.capacity}</span>
                </div>
            </CardFooter>
          </Card>
        ))}
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle>Edit Clinician Profile</DialogTitle>
                <DialogDescription>Update professional details, capacity, and preferences.</DialogDescription>
            </DialogHeader>
            
            {selectedClinician && (
                <div className="grid gap-6 py-4">
                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Full Name</Label>
                            <Input defaultValue={selectedClinician.name} />
                        </div>
                        <div className="space-y-2">
                            <Label>Tier</Label>
                            <Select defaultValue={selectedClinician.tier || "Associate"}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Associate">Associate</SelectItem>
                                    <SelectItem value="Senior">Senior</SelectItem>
                                    <SelectItem value="Director">Director</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Bio</Label>
                        <Textarea className="min-h-[100px]" defaultValue={selectedClinician.bio} />
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Geographical Location</Label>
                            <Input defaultValue={selectedClinician.location} placeholder="e.g. North London" />
                        </div>
                        <div className="space-y-2">
                            <Label>NHS Trust</Label>
                            <Input defaultValue={selectedClinician.nhsTrust} placeholder="e.g. Tavistock" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Insurers Accepted</Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border p-3 rounded-md bg-slate-50/50">
                            {INSURERS.map(insurer => (
                                <div key={insurer} className="flex items-center space-x-2">
                                    <Checkbox id={`ins-${insurer}`} defaultChecked={selectedClinician.insurers?.includes(insurer)} />
                                    <Label htmlFor={`ins-${insurer}`} className="font-normal cursor-pointer">{insurer}</Label>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4">
                        <div className="space-y-2 border p-3 rounded-md">
                            <div className="flex items-center justify-between mb-2">
                                <Label>New Client Capacity</Label>
                                <span className="text-xs text-muted-foreground">Monthly Cap</span>
                            </div>
                            <Input type="number" defaultValue={selectedClinician.maxNewClients} />
                            <p className="text-[10px] text-muted-foreground pt-1">
                                Stop allocating after this many new clients.
                            </p>
                        </div>
                        <div className="space-y-2 border p-3 rounded-md flex flex-col justify-center">
                            <div className="flex items-center space-x-2">
                                <Checkbox id="couples" defaultChecked={selectedClinician.worksWithCouples} />
                                <Label htmlFor="couples" className="font-medium cursor-pointer">Works with Couples</Label>
                            </div>
                            <div className="flex items-center space-x-2 mt-3">
                                <Checkbox id="bupa-prio" defaultChecked={selectedClinician.insurers?.includes("Bupa")} />
                                <Label htmlFor="bupa-prio" className="font-medium cursor-pointer">Allocate for Bupa</Label>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                <Button onClick={handleSave}>Save Changes</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
