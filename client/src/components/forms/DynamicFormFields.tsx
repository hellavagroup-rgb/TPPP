import React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export type DynamicFormState = Record<string, any>;
export type DynamicFormField = Record<string, any>;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIME_PERIODS = ["Morning", "Afternoon", "Evening"];

export function isDynamicFieldVisible(field: DynamicFormField, values: DynamicFormState) {
  if (field.conditional) return values[field.conditional.fieldId] === field.conditional.value;
  if (field.showWhen) {
    const value = values[field.showWhen.field];
    if (field.showWhen.equals !== undefined) return value === field.showWhen.equals;
    if (field.showWhen.contains !== undefined) return Array.isArray(value) ? value.includes(field.showWhen.contains) : value === field.showWhen.contains;
  }
  return true;
}

export function validateDynamicFields(fields: DynamicFormField[], values: DynamicFormState) {
  return fields.reduce<Record<string, boolean>>((errors, field) => {
    const value = values[field.id];
    const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && Object.keys(value).length === 0);
    if (field.required && isDynamicFieldVisible(field, values) && empty) errors[field.id] = true;
    return errors;
  }, {});
}

function AvailabilityPicker({ value, onChange, error }: { value: Record<string, string[]>; onChange: (value: Record<string, string[]>) => void; error?: boolean }) {
  const toggle = (day: string, period: string) => {
    const slots = value[day] || [];
    const next = slots.includes(period) ? slots.filter(slot => slot !== period) : [...slots, period];
    const updated = { ...value };
    if (next.length) updated[day] = next; else delete updated[day];
    onChange(updated);
  };
  return <div className={cn("overflow-x-auto", error && "ring-2 ring-destructive ring-offset-2 rounded-lg")}>
    <div className="min-w-[400px] grid grid-cols-6 gap-2">
      <div />{DAYS.map(day => <div key={day} className="p-2 text-sm font-medium text-center bg-slate-100 rounded-t-md">{day.slice(0, 3)}</div>)}
      {TIME_PERIODS.flatMap(period => [<div key={`${period}-label`} className="p-2 text-sm font-medium text-right text-muted-foreground">{period}</div>, ...DAYS.map(day => {
        const selected = (value[day] || []).includes(period);
        return <button key={`${day}-${period}`} type="button" onClick={() => toggle(day, period)} className={cn("p-3 text-sm border rounded-lg transition-all hover:scale-105", selected ? "bg-emerald-500 text-white border-emerald-600 shadow-sm" : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50")}>{selected ? "✓" : ""}</button>;
      })])}
    </div>
  </div>;
}

export function DynamicFormFields({ fields, values, errors = {}, onChange }: { fields: DynamicFormField[]; values: DynamicFormState; errors?: Record<string, boolean>; onChange: (id: string, value: any) => void }) {
  const checkboxChange = (id: string, option: string, checked: boolean) => {
    const current = values[id] || [];
    onChange(id, checked ? [...current, option] : current.filter((value: string) => value !== option));
  };
  return <>{fields.map(field => {
    if (!isDynamicFieldVisible(field, values)) return null;
    const error = errors[field.id];
    if (field.type === "section") return <div key={field.id} className="pt-6 pb-2 border-b"><h3 className="text-xl font-serif font-bold text-slate-800">{field.label}</h3></div>;
    if (field.type === "info") return <div key={field.id} className="bg-blue-50 p-4 rounded-md text-slate-700 leading-relaxed text-sm border border-blue-100">{field.label && <strong className="block mb-2 text-slate-900">{field.label}</strong>}<div className="whitespace-pre-wrap">{field.content}</div></div>;
    return <div key={field.id} className="grid gap-2" data-error={error}>
      <Label className={cn("text-base font-medium text-slate-900", error && "text-destructive")}>{field.label}{field.required && <span className="text-destructive ml-1">*</span>}</Label>
      {["text", "email", "tel"].includes(field.type) && <Input type={field.type} placeholder={field.placeholder} value={values[field.id] || ""} onChange={e => onChange(field.id, e.target.value)} className={cn(error && "border-destructive focus-visible:ring-destructive")} />}
      {field.type === "textarea" && <Textarea placeholder={field.placeholder} value={values[field.id] || ""} onChange={e => onChange(field.id, e.target.value)} className={cn("min-h-[120px]", error && "border-destructive focus-visible:ring-destructive")} />}
      {field.type === "select" && <Select value={values[field.id]} onValueChange={value => onChange(field.id, value)}><SelectTrigger className={cn(error && "border-destructive")}><SelectValue placeholder="Select an option" /></SelectTrigger><SelectContent>{field.options?.map((option: string) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>}
      {field.type === "radio" && <RadioGroup value={values[field.id]} onValueChange={value => onChange(field.id, value)} className="space-y-3 pt-1">{field.options?.map((option: string) => <div key={option} className="flex items-start space-x-3 bg-slate-50 p-3 rounded-md border border-slate-100"><RadioGroupItem value={option} id={`${field.id}-${option}`} className="mt-1" /><Label htmlFor={`${field.id}-${option}`} className="font-normal cursor-pointer flex-1">{option}</Label></div>)}</RadioGroup>}
      {field.type === "checkbox" && <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">{field.options?.map((option: string) => <div key={option} className="flex items-start space-x-3 bg-slate-50 p-3 rounded-md border border-slate-100"><Checkbox id={`${field.id}-${option}`} checked={(values[field.id] || []).includes(option)} onCheckedChange={checked => checkboxChange(field.id, option, !!checked)} /><Label htmlFor={`${field.id}-${option}`} className="font-normal cursor-pointer flex-1">{option}</Label></div>)}</div>}
      {field.type === "date" && <Popover><PopoverTrigger asChild><Button type="button" variant="outline" className={cn("w-full pl-3 text-left font-normal", !values[field.id] && "text-muted-foreground", error && "border-destructive")} >{values[field.id] ? format(values[field.id], "dd/MM/yyyy") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-auto p-0" align="start"><Calendar mode="single" selected={values[field.id]} onSelect={date => onChange(field.id, date)} disabled={date => date < new Date("1900-01-01")} captionLayout="dropdown" fromYear={1920} toYear={new Date().getFullYear() + 5} initialFocus /></PopoverContent></Popover>}
      {field.type === "availability" && <AvailabilityPicker value={values[field.id] || {}} onChange={value => onChange(field.id, value)} error={error} />}
      {error && <p className="text-sm text-destructive font-medium">This field is required</p>}
    </div>;
  })}</>;
}