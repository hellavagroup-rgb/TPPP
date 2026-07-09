import React, { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, CheckCircle2, Lock, Loader2, Save, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FormTemplate, Client } from "@shared/schema";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const TIME_PERIODS = [
  { label: "Morning", value: "Morning" },
  { label: "Afternoon", value: "Afternoon" },
  { label: "Evening", value: "Evening" },
];

interface AvailabilityPickerProps {
  value: Record<string, string[]>;
  onChange: (value: Record<string, string[]>) => void;
  error?: boolean;
}

function AvailabilityPicker({ value, onChange, error }: AvailabilityPickerProps) {
  const toggleSlot = (day: string, period: string) => {
    const currentDaySlots = value[day] || [];
    const isSelected = currentDaySlots.includes(period);
    
    const newDaySlots = isSelected
      ? currentDaySlots.filter(p => p !== period)
      : [...currentDaySlots, period];
    
    const newValue = { ...value };
    if (newDaySlots.length === 0) {
      delete newValue[day];
    } else {
      newValue[day] = newDaySlots;
    }
    
    onChange(newValue);
  };

  const hasAnySelection = Object.keys(value).length > 0;

  return (
    <div className={cn("space-y-4", error && "ring-2 ring-destructive ring-offset-2 rounded-lg")}>
      <p className="text-sm text-muted-foreground">
        Select all the times you are generally available for appointments. Click on a time slot to toggle it.
      </p>
      
      <div className="overflow-x-auto">
        <div className="min-w-[400px]">
          <div className="grid grid-cols-6 gap-2">
            <div className="p-2 text-sm font-medium text-center text-muted-foreground"></div>
            {DAYS.map(day => (
              <div key={day} className="p-2 text-sm font-medium text-center bg-slate-100 rounded-t-md">
                {day.slice(0, 3)}
              </div>
            ))}
          </div>
          
          {TIME_PERIODS.map(({ label, value: period }) => (
            <div key={period} className="grid grid-cols-6 gap-2 mt-1">
              <div className="p-2 text-sm font-medium text-right text-muted-foreground pr-3">
                {label}
              </div>
              {DAYS.map(day => {
                const isSelected = (value[day] || []).includes(period);
                return (
                  <button
                    key={`${day}-${period}`}
                    type="button"
                    onClick={() => toggleSlot(day, period)}
                    className={cn(
                      "p-3 text-sm border rounded-lg transition-all hover:scale-105",
                      isSelected
                        ? "bg-emerald-500 text-white border-emerald-600 shadow-sm"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    )}
                    data-testid={`availability-slot-${day.toLowerCase()}-${period.toLowerCase()}`}
                  >
                    {isSelected ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      
      {hasAnySelection && (
        <div className="bg-emerald-50 p-3 rounded-md border border-emerald-100">
          <p className="text-sm font-medium text-emerald-800 mb-2">Your selected availability:</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(day => {
              const slots = value[day];
              if (!slots || slots.length === 0) return null;
              return (
                <span key={day} className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs">
                  <strong>{day.slice(0, 3)}:</strong> {slots.join(", ")}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function linkifyText(text: string): React.ReactNode[] {
  const urlRegex = /https?:\/\/[^\s]+/g;
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    const url = match[0];
    result.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{url}</a>
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }
  return result;
}

export default function FormFill() {
  const [, params] = useRoute("/fill/:clientId/:formId");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formState, setFormState] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const { data: form, isLoading: formLoading } = useQuery<FormTemplate>({
    queryKey: [`/api/forms/${params?.formId}`],
    enabled: !!params?.formId,
  });

  const { data: client, isLoading: clientLoading } = useQuery<Client>({
    queryKey: [`/api/clients/public/${params?.clientId}`],
    enabled: !!params?.clientId,
  });

  const { data: branding } = useQuery<{ name: string; logoUrl: string | null }>({
    queryKey: [`/api/tenant/branding?clientId=${params?.clientId}`],
    enabled: !!params?.clientId,
  });
  const brandLogo = branding?.logoUrl || null;
  const brandName = branding?.name || "PsychPortal";

  const { data: completionPage } = useQuery<{ heading: string; body: string }>({
    queryKey: [`/api/public/form-completion-page/${params?.clientId}`],
    enabled: !!params?.clientId,
  });

  // Check for existing draft
  const { data: draftData, isLoading: draftLoading } = useQuery<{
    hasDraft: boolean;
    draftId?: string;
    responses?: Record<string, any>;
    savedAt?: string;
  }>({
    queryKey: [`/api/form-drafts/${params?.clientId}/${params?.formId}`],
    enabled: !!params?.clientId && !!params?.formId,
  });

  // Load draft data into form state when available
  useEffect(() => {
    if (draftData?.hasDraft && draftData.responses && !draftLoaded) {
      setFormState(draftData.responses as Record<string, any>);
      if (draftData.savedAt) {
        setLastSaved(new Date(draftData.savedAt));
      }
      setDraftLoaded(true);
    }
  }, [draftData, draftLoaded]);

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Save draft mutation
  const saveDraftMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await fetch(`/api/form-drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formId: params?.formId,
          clientId: params?.clientId,
          data,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to save");
      }
      return response.json();
    },
    onSuccess: (data) => {
      setLastSaved(new Date(data.savedAt));
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 3000);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const response = await fetch(`/api/form-submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formId: params?.formId,
          clientId: params?.clientId,
          data,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Submission failed");
      }
      return response.json();
    },
    onSuccess: () => {
      setSubmitError(null);
      setIsSubmitted(true);
    },
    onError: (error: Error) => {
      setSubmitError(error.message || "Failed to submit form. Please try again.");
    },
  });

  // Note: We don't pre-fill email from client record for privacy
  // The client will enter their email in the form

  const handleValueChange = (fieldId: string, value: any) => {
    setFormState(prev => ({ ...prev, [fieldId]: value }));
    // Clear error if exists
    if (errors[fieldId]) {
        const newErrors = { ...errors };
        delete newErrors[fieldId];
        setErrors(newErrors);
    }
  };

  const isFieldVisible = (field: any) => {
    // Support both old 'conditional' format and new 'showWhen' format
    if (field.conditional) {
      return formState[field.conditional.fieldId] === field.conditional.value;
    }
    if (field.showWhen) {
      const dependentValue = formState[field.showWhen.field];
      if (field.showWhen.equals) {
        return dependentValue === field.showWhen.equals;
      }
      if (field.showWhen.contains) {
        // For checkbox arrays or string containing value
        if (Array.isArray(dependentValue)) {
          return dependentValue.includes(field.showWhen.contains);
        }
        return dependentValue === field.showWhen.contains;
      }
    }
    return true;
  };

  const handleSubmit = () => {
    if (!form || !client) return;

    const fields = form.fields as any[];
    const newErrors: Record<string, boolean> = {};
    let hasError = false;

    fields.forEach((field: any) => {
        if (isFieldVisible(field) && field.required && !formState[field.id]) {
            newErrors[field.id] = true;
            hasError = true;
        }
    });

    if (hasError) {
        setErrors(newErrors);
        const firstError = document.querySelector('[data-error="true"]');
        if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }

    submitMutation.mutate(formState);
  };

  const handleCheckboxChange = (fieldId: string, option: string, checked: boolean) => {
    const currentValue = formState[fieldId] || [];
    const newValue = checked 
      ? [...currentValue, option]
      : currentValue.filter((v: string) => v !== option);
    handleValueChange(fieldId, newValue);
  };

  const handleSaveDraft = () => {
    saveDraftMutation.mutate(formState);
  };

  if (isSubmitted) {
    const heading = completionPage?.heading || 'Thank you for completing our intake form.';
    const paragraphs = (completionPage?.body || '').split('\n\n').filter(Boolean);

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <Card className="max-w-xl w-full text-center p-6 shadow-lg border-t-4 border-t-emerald-500">
          <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4 text-emerald-600">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-serif font-bold text-slate-900 mb-4">{heading}</h1>
          <div className="text-slate-600 text-left space-y-4 mb-6">
            {paragraphs.map((para, i) => (
              <p key={i}>{linkifyText(para)}</p>
            ))}
          </div>
          <Button variant="outline" onClick={() => window.close()}>
            Close Window
          </Button>
        </Card>
      </div>
    );
  }

  if (formLoading || clientLoading || draftLoading) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            <p className="text-slate-500">Loading form...</p>
          </div>
        </div>
      );
  }

  if (!form || !client) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <Card className="max-w-md w-full p-6 text-center">
            <CardHeader>
              <CardTitle>Form Not Found</CardTitle>
              <CardDescription>This form link may be invalid or expired.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
  }

  const fields = form.fields as any[];

  // Security: Check if form is already completed
  if (client.status === "Forms Completed" && !isSubmitted) {
      return (
          <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
              <div className="flex flex-col items-center mb-8">
                  {brandLogo ? (
                      <img src={brandLogo} alt={brandName} className="h-12 object-contain mb-4 opacity-80 grayscale" />
                  ) : (
                      <p className="text-slate-700 font-serif font-bold text-lg mb-4">{brandName}</p>
                  )}
                  <div className="flex items-center gap-2 text-slate-500 text-sm font-medium">
                      <Lock className="h-4 w-4" />
                      Secure Client Portal
                  </div>
              </div>
              
              <Card className="max-w-md w-full p-6 shadow-lg border-t-4 border-t-slate-800">
                  <CardHeader className="px-0 pt-0 text-center">
                      <div className="mx-auto w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-500">
                          <Lock className="h-6 w-6" />
                      </div>
                      <CardTitle className="text-xl font-serif font-bold text-slate-900">Link Expired</CardTitle>
                      <CardDescription>
                          This form has already been submitted and can no longer be accessed.
                      </CardDescription>
                  </CardHeader>
                  <CardContent className="text-center text-sm text-muted-foreground pb-2">
                      <p>For security reasons, form links expire after submission. If you believe this is an error or need to update your information, please contact the practice directly.</p>
                  </CardContent>
                  <CardFooter className="justify-center pt-4">
                      <Button variant="outline" onClick={() => window.close()}>
                          Close Window
                      </Button>
                  </CardFooter>
              </Card>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="flex flex-col items-center text-center space-y-4">
            {brandLogo ? (
                <img src={brandLogo} alt={brandName} className="h-16 object-contain" />
            ) : (
                <p className="text-slate-800 font-serif font-bold text-2xl">{brandName}</p>
            )}
            <div className="space-y-1">
                <h1 className="text-3xl font-serif font-bold text-slate-900">{form.title}</h1>
                <p className="text-slate-600 max-w-lg mx-auto">{form.description}</p>
            </div>
        </div>

        {draftData?.hasDraft && (
            <Alert className="bg-blue-50 border-blue-200">
                <Clock className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800">
                    We've restored your previously saved progress. Continue where you left off, or start fresh by clearing the fields.
                </AlertDescription>
            </Alert>
        )}

        <Card className="shadow-lg border-0 ring-1 ring-slate-200">
            <CardContent className="p-6 sm:p-10 space-y-8">
                {fields.map((field: any) => {
                    if (!isFieldVisible(field)) return null;

                    return (
                        <div 
                            key={field.id} 
                            className={cn("space-y-3", field.type === "section" && "pt-6 pb-2 border-b")}
                            data-error={errors[field.id]}
                        >
                            {field.type === "section" ? (
                                <h3 className="text-xl font-serif font-bold text-slate-800">{field.label}</h3>
                            ) : field.type === "info" ? (
                                <div className="bg-blue-50 p-4 rounded-md text-slate-700 leading-relaxed text-sm border border-blue-100">
                                    {field.label && <strong className="block mb-2 text-slate-900">{field.label}</strong>}
                                    <div className="whitespace-pre-wrap">{field.content}</div>
                                </div>
                            ) : (
                                <div className="grid gap-2">
                                    <Label className={cn("text-base font-medium text-slate-900", errors[field.id] && "text-destructive")}>
                                        {field.label}
                                        {field.required && <span className="text-destructive ml-1">*</span>}
                                    </Label>
                                    
                                    {(field.type === "text" || field.type === "email" || field.type === "tel") && (
                                        <Input 
                                            type={field.type} 
                                            placeholder={field.placeholder}
                                            value={formState[field.id] || ""}
                                            onChange={(e) => handleValueChange(field.id, e.target.value)}
                                            className={cn(errors[field.id] && "border-destructive focus-visible:ring-destructive")}
                                        />
                                    )}
                                    
                                    {field.type === "textarea" && (
                                        <Textarea 
                                            placeholder={field.placeholder}
                                            value={formState[field.id] || ""}
                                            onChange={(e) => handleValueChange(field.id, e.target.value)}
                                            className={cn("min-h-[120px]", errors[field.id] && "border-destructive focus-visible:ring-destructive")}
                                        />
                                    )}

                                    {field.type === "select" && (
                                        <Select onValueChange={(val) => handleValueChange(field.id, val)} value={formState[field.id]}>
                                            <SelectTrigger className={cn(errors[field.id] && "border-destructive focus:ring-destructive")}>
                                                <SelectValue placeholder="Select an option" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {field.options?.map((opt: string) => (
                                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    )}

                                    {field.type === "radio" && (
                                        <RadioGroup 
                                            value={formState[field.id]} 
                                            onValueChange={(val) => handleValueChange(field.id, val)}
                                            className="space-y-3 pt-1"
                                        >
                                            {field.options?.map((option: string) => (
                                                <div key={option} className="flex items-start space-x-3 bg-slate-50 p-3 rounded-md border border-slate-100 hover:border-slate-300 transition-colors">
                                                    <RadioGroupItem value={option} id={`${field.id}-${option}`} className="mt-1" />
                                                    <Label htmlFor={`${field.id}-${option}`} className="font-normal cursor-pointer flex-1 leading-snug">{option}</Label>
                                                </div>
                                            ))}
                                        </RadioGroup>
                                    )}

                                    {field.type === "checkbox" && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                                            {field.options?.map((option: string) => (
                                                <div key={option} className="flex items-start space-x-3 bg-slate-50 p-3 rounded-md border border-slate-100 hover:border-slate-300 transition-colors">
                                                    <Checkbox 
                                                        id={`${field.id}-${option}`}
                                                        className="mt-1"
                                                        checked={(formState[field.id] || []).includes(option)}
                                                        onCheckedChange={(checked) => handleCheckboxChange(field.id, option, !!checked)}
                                                    />
                                                    <Label htmlFor={`${field.id}-${option}`} className="font-normal cursor-pointer flex-1 leading-snug">{option}</Label>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {field.type === "date" && (
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full pl-3 text-left font-normal",
                                                        !formState[field.id] && "text-muted-foreground",
                                                        errors[field.id] && "border-destructive text-destructive hover:text-destructive"
                                                    )}
                                                >
                                                    {formState[field.id] ? (
                                                        format(formState[field.id], "dd/MM/yyyy")
                                                    ) : (
                                                        <span>Pick a date</span>
                                                    )}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-auto p-0" align="start">
                                                <Calendar
                                                    mode="single"
                                                    selected={formState[field.id]}
                                                    onSelect={(date) => handleValueChange(field.id, date)}
                                                    disabled={(date) =>
                                                        date < new Date("1900-01-01")
                                                    }
                                                    captionLayout="dropdown"
                                                    fromYear={1920}
                                                    toYear={new Date().getFullYear() + 5}
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    )}

                                    {field.type === "availability" && (
                                        <AvailabilityPicker
                                            value={formState[field.id] || {}}
                                            onChange={(val) => handleValueChange(field.id, val)}
                                            error={errors[field.id]}
                                        />
                                    )}

                                    {errors[field.id] && (
                                        <p className="text-sm text-destructive font-medium">This field is required</p>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </CardContent>
            <CardFooter className="p-6 sm:p-10 pt-0 bg-slate-50/50 border-t mt-4 flex flex-col gap-4">
                {submitError && (
                    <div className="w-full p-4 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm">
                        <strong>Error:</strong> {submitError}
                    </div>
                )}
                
                {showSaveSuccess && (
                    <Alert className="bg-emerald-50 border-emerald-200">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <AlertDescription className="text-emerald-800">
                            Your progress has been saved. You can close this page and return later to complete the form.
                        </AlertDescription>
                    </Alert>
                )}
                
                {lastSaved && !showSaveSuccess && (
                    <div className="w-full flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>Last saved: {format(lastSaved, "d MMM yyyy 'at' h:mm a")}</span>
                    </div>
                )}
                
                <div className="w-full flex flex-col sm:flex-row justify-between items-center gap-4">
                    <p className="text-sm text-muted-foreground">Securely powered by {brandName}</p>
                    <div className="flex gap-3">
                        <Button 
                            variant="outline" 
                            size="lg" 
                            onClick={handleSaveDraft} 
                            disabled={saveDraftMutation.isPending || submitMutation.isPending}
                        >
                            {saveDraftMutation.isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    Save Progress
                                </>
                            )}
                        </Button>
                        <Button size="lg" onClick={handleSubmit} disabled={submitMutation.isPending || saveDraftMutation.isPending} className="px-8">
                            {submitMutation.isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                "Submit Form"
                            )}
                        </Button>
                    </div>
                </div>
            </CardFooter>
        </Card>
      </div>
    </div>
  );
}
