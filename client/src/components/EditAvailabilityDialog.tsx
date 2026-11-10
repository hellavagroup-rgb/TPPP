import { useState } from "react";
import type { TimeSlot } from "@shared/schema";
import { availabilityEditSchema } from "@shared/availabilityEdit";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function EditAvailabilityDialog({ slot, onClose, onSaved, cyaAvailabilityLabels = false }: {
  slot: TimeSlot; onClose: () => void; onSaved: () => void; cyaAvailabilityLabels?: boolean;
}) {
  const recurring = slot.type === "Recurring";
  const [day, setDay] = useState(slot.day || "Monday");
  const [date, setDate] = useState(slot.date || "");
  const [startDate, setStartDate] = useState(slot.startDate || "");
  const [endDate, setEndDate] = useState(slot.endDate || "");
  const [startTime, setStartTime] = useState(slot.startTime);
  const [endTime, setEndTime] = useState(slot.endTime);
  const [frequency, setFrequency] = useState(slot.frequency || "weekly");
  const [locationType, setLocationType] = useState(slot.locationType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
  async function save() {
    const parsed = availabilityEditSchema.safeParse({
      type: slot.type, startTime, endTime, locationType,
      ...(recurring ? { day, startDate: startDate || null, endDate: endDate || null, frequency } : { date }),
    });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setSaving(true);
    setError("");
    try {
      await apiRequest("PATCH", `/api/timeslots/${slot.id}/schedule`, parsed.data);
      onSaved();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.replace(/^\d+:\s*/, "") : "Could not save availability.";
      try { setError(JSON.parse(message).error || "Could not save availability."); } catch { setError(message); }
    } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recurring ? "Edit recurring series" : "Edit one-off availability"}</DialogTitle>
          <DialogDescription>{recurring
            ? "Changes apply to this whole recurring series, not just the date shown on the calendar. This does not create a single-date exception."
            : "Changes apply only to this one date, not to any recurring series."} Booked, reserved and currently offered slots are protected.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!saving) void save(); }}>
          <fieldset disabled={saving} className="space-y-4">
            {recurring ? <>
              <div><Label htmlFor="edit-slot-day">Day</Label><select id="edit-slot-day" className={selectClass} value={day} onChange={e => setDay(e.target.value)}>
                {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map(value => <option key={value}>{value}</option>)}
              </select></div>
              <div><Label htmlFor="edit-slot-frequency">Frequency</Label><select id="edit-slot-frequency" className={selectClass} value={frequency} onChange={e => setFrequency(e.target.value as "weekly" | "fortnightly")}>
                <option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option>
              </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="edit-slot-start-date">Start date</Label><Input id="edit-slot-start-date" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
                <div><Label htmlFor="edit-slot-end-date">End date (optional)</Label><Input id="edit-slot-end-date" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
              </div>
              <p className="text-xs text-muted-foreground">An empty end date means ongoing. Fortnightly series require a start date to identify alternating weeks.</p>
            </> : <div><Label htmlFor="edit-slot-date">Date</Label><Input id="edit-slot-date" type="date" required value={date} onChange={e => setDate(e.target.value)} /></div>}
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="edit-slot-start-time">Start time</Label><Input id="edit-slot-start-time" type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
              <div><Label htmlFor="edit-slot-end-time">End time</Label><Input id="edit-slot-end-time" type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} /></div>
            </div>
            <div><Label htmlFor="edit-slot-location">Session format</Label><select id="edit-slot-location" className={selectClass} value={locationType} onChange={e => setLocationType(e.target.value as TimeSlot["locationType"])}>
              <option value="online">{cyaAvailabilityLabels ? "Online only" : "Online"}</option>
              <option value="in_person">{cyaAvailabilityLabels ? "At the practice — in person or online" : "In person"}</option>
            </select>
              {cyaAvailabilityLabels && <p className="text-xs text-muted-foreground mt-1">At the practice availability can be delivered in person or online; online-only availability is remote.</p>}
            </div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : recurring ? "Save series changes" : "Save date changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
