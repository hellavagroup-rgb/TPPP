import { useState, useEffect } from "react";
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
import { CalendarIcon, CheckCircle2, Lock, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import logo from "@assets/xPerinatalPP-logo-large-digital.png.pagespeed.ic.wAjk_RUOnf_1766008188694.png";
import type { FormTemplate, Client } from "@shared/schema";

export default function FormFill() {
  const [, params] = useRoute("/fill/:clientId/:formId");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formState, setFormState] = useState<Record<string, any>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const { data: form, isLoading: formLoading } = useQuery<FormTemplate>({
    queryKey: [`/api/forms/${params?.formId}`],
    enabled: !!params?.formId,
  });

  const { data: client, isLoading: clientLoading } = useQuery<Client>({
    queryKey: [`/api/clients/public/${params?.clientId}`],
    enabled: !!params?.clientId,
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

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

  if (isSubmitted) {
      return (
          <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
              <Card className="max-w-md w-full text-center p-6 shadow-lg border-t-4 border-t-emerald-500">
                  <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4 text-emerald-600">
                      <CheckCircle2 className="h-8 w-8" />
                  </div>
                  <h1 className="text-2xl font-serif font-bold text-slate-900 mb-2">Thank You</h1>
                  <p className="text-slate-600 mb-6">
                      Your form has been successfully submitted to The Perinatal Psychology Practice. We will review your information and be in touch shortly.
                  </p>
                  <Button variant="outline" onClick={() => window.close()}>
                      Close Window
                  </Button>
              </Card>
          </div>
      );
  }

  if (formLoading || clientLoading) {
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
                  <img src={logo} alt="Logo" className="h-12 object-contain mb-4 opacity-80 grayscale" />
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
            <img src={logo} alt="Logo" className="h-16 object-contain" />
            <div className="space-y-1">
                <h1 className="text-3xl font-serif font-bold text-slate-900">{form.title}</h1>
                <p className="text-slate-600 max-w-lg mx-auto">{form.description}</p>
            </div>
        </div>

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
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
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
                <div className="w-full flex justify-between items-center">
                    <p className="text-sm text-muted-foreground">Securely powered by Perinatal Psychology Practice</p>
                    <Button size="lg" onClick={handleSubmit} disabled={submitMutation.isPending} className="px-8">
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
            </CardFooter>
        </Card>
      </div>
    </div>
  );
}
