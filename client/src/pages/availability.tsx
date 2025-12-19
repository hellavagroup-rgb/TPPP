import { useData, TimeSlot } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import { Plus, Trash2, Calendar, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Availability() {
  const { clinicians, updateClinicianAvailability } = useData();
  // Simulate logged-in user being "Dr. Emily Chen" (c1)
  const myId = "c1"; 
  const me = clinicians.find(c => c.id === myId);
  const [slots, setSlots] = useState<TimeSlot[]>(me?.availability || []);
  const { toast } = useToast();

  const [newDay, setNewDay] = useState("Monday");
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("17:00");

  const handleAddSlot = () => {
    const newSlot: TimeSlot = {
      id: `ts-${Date.now()}`,
      day: newDay,
      startTime: newStart,
      endTime: newEnd,
      isBooked: false
    };
    setSlots([...slots, newSlot]);
  };

  const handleRemoveSlot = (id: string) => {
    setSlots(slots.filter(s => s.id !== id));
  };

  const handleSave = () => {
    updateClinicianAvailability(myId, slots);
    toast({
      title: "Availability Updated",
      description: "Your schedule has been saved and allocation team notified.",
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-serif font-bold text-foreground">My Availability</h2>
        <p className="text-muted-foreground mt-1">Set your working hours for the upcoming weeks.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Editor */}
        <Card className="md:col-span-2 border-none shadow-sm">
          <CardHeader>
            <CardTitle>Manage Slots</CardTitle>
            <CardDescription>Add times when you are available for new allocations.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            
            <div className="flex flex-col md:flex-row gap-4 items-end bg-muted/30 p-4 rounded-lg border border-border">
              <div className="grid gap-2 flex-1 w-full">
                <Label>Day</Label>
                <Select value={newDay} onValueChange={setNewDay}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(d => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2 w-full md:w-32">
                <Label>Start</Label>
                <Input type="time" value={newStart} onChange={e => setNewStart(e.target.value)} />
              </div>
              <div className="grid gap-2 w-full md:w-32">
                <Label>End</Label>
                <Input type="time" value={newEnd} onChange={e => setNewEnd(e.target.value)} />
              </div>
              <Button onClick={handleAddSlot} className="w-full md:w-auto">
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground mb-4">CURRENT SCHEDULE</h3>
              {slots.length === 0 && <p className="text-sm text-muted-foreground italic">No slots set.</p>}
              
              <div className="grid gap-2">
                {slots.map(slot => (
                  <div key={slot.id} className="flex items-center justify-between p-3 bg-card border border-border rounded-md shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-secondary/30 rounded text-secondary-foreground">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium">{slot.day}</p>
                        <p className="text-sm text-muted-foreground">{slot.startTime} - {slot.endTime}</p>
                      </div>
                      {slot.isBooked && <Badge variant="destructive" className="ml-2">Booked</Badge>}
                    </div>
                    {!slot.isBooked && (
                      <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleRemoveSlot(slot.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-border flex justify-end">
              <Button size="lg" onClick={handleSave} className="gap-2">
                <Save className="h-4 w-4" /> Save Schedule
              </Button>
            </div>

          </CardContent>
        </Card>

        {/* Instructions / Sidebar */}
        <div className="space-y-4">
          <Card className="border-none shadow-sm bg-primary/5 border-primary/20">
            <CardHeader>
              <CardTitle className="text-primary text-lg">Reminders</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <p>Please update your availability by the <strong>25th of each month</strong>.</p>
              <p>Once a slot is allocated to a client (W-Number), you will receive an email notification with their details.</p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
             <CardHeader>
                <CardTitle className="text-lg">My Load</CardTitle>
             </CardHeader>
             <CardContent>
                <div className="text-center py-4">
                    <p className="text-3xl font-bold text-foreground">{me?.currentLoad} / {me?.capacity}</p>
                    <p className="text-xs text-muted-foreground">Current Active Clients</p>
                </div>
                <Progress value={(me!.currentLoad / me!.capacity) * 100} className="h-2" />
             </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
