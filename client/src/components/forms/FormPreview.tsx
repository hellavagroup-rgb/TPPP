import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FormTemplate } from "@/lib/mockData";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Eye } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface FormPreviewProps {
    form: FormTemplate;
}

export function FormPreview({ form }: FormPreviewProps) {
    // We only need to render the form visually, not handle state for the preview
    // But for conditional logic to be visible, we might need simple state.
    // For now, let's just render all fields so the user sees what's in the form, 
    // or maybe simple state for top-level conditionals if needed.
    // Given the complexity, static rendering or simple interaction is best for "Preview".
    
    // To make it look "live", let's use a simple state map for conditionals
    const [formState, setFormState] = useState<Record<string, any>>({});

    const handleValueChange = (fieldId: string, value: any) => {
        setFormState(prev => ({ ...prev, [fieldId]: value }));
    };

    const isFieldVisible = (field: any) => {
        if (!field.conditional) return true;
        return formState[field.conditional.fieldId] === field.conditional.value;
    };

    return (
        <ScrollArea className="h-[600px] w-full rounded-md border p-4 bg-white/50">
            <div className="max-w-2xl mx-auto space-y-8 p-4 bg-white shadow-sm rounded-lg border">
                <div className="text-center space-y-2 mb-8">
                    <h2 className="text-2xl font-serif font-bold text-primary">{form.title}</h2>
                    <p className="text-muted-foreground text-sm">{form.description}</p>
                </div>

                <div className="space-y-6">
                    {form.fields.map((field) => {
                        if (!isFieldVisible(field)) return null;

                        switch (field.type) {
                            case "section":
                                return (
                                    <div key={field.id} className="pt-4 pb-2">
                                        <h3 className="text-lg font-semibold text-primary/80 border-b pb-1">{field.label}</h3>
                                    </div>
                                );
                            case "info":
                                return (
                                    <div key={field.id} className="bg-blue-50 p-4 rounded-md text-sm text-blue-900 leading-relaxed whitespace-pre-wrap">
                                        {field.label && <strong className="block mb-2 text-blue-700">{field.label}</strong>}
                                        {field.content}
                                    </div>
                                );
                            case "text":
                            case "email":
                            case "tel":
                                return (
                                    <div key={field.id} className="grid gap-2">
                                        <Label>
                                            {field.label}
                                            {field.required && <span className="text-red-500 ml-1">*</span>}
                                        </Label>
                                        <Input 
                                            type={field.type} 
                                            placeholder={field.placeholder} 
                                            value={formState[field.id] || ""}
                                            onChange={(e) => handleValueChange(field.id, e.target.value)}
                                        />
                                    </div>
                                );
                            case "textarea":
                                return (
                                    <div key={field.id} className="grid gap-2">
                                        <Label>
                                            {field.label}
                                            {field.required && <span className="text-red-500 ml-1">*</span>}
                                        </Label>
                                        <Textarea 
                                            placeholder={field.placeholder}
                                            value={formState[field.id] || ""}
                                            onChange={(e) => handleValueChange(field.id, e.target.value)}
                                            className="min-h-[100px]"
                                        />
                                    </div>
                                );
                            case "date":
                                return (
                                    <div key={field.id} className="grid gap-2 flex-col">
                                        <Label>
                                            {field.label}
                                            {field.required && <span className="text-red-500 ml-1">*</span>}
                                        </Label>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    className={cn(
                                                        "w-full pl-3 text-left font-normal",
                                                        !formState[field.id] && "text-muted-foreground"
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
                                                        date > new Date() || date < new Date("1900-01-01")
                                                    }
                                                    initialFocus
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </div>
                                );
                            case "radio":
                                return (
                                    <div key={field.id} className="grid gap-3">
                                        <Label>
                                            {field.label}
                                            {field.required && <span className="text-red-500 ml-1">*</span>}
                                        </Label>
                                        <RadioGroup 
                                            value={formState[field.id]} 
                                            onValueChange={(val) => handleValueChange(field.id, val)}
                                        >
                                            {field.options?.map((option) => (
                                                <div key={option} className="flex items-center space-x-2">
                                                    <RadioGroupItem value={option} id={`${field.id}-${option}`} />
                                                    <Label htmlFor={`${field.id}-${option}`} className="font-normal">{option}</Label>
                                                </div>
                                            ))}
                                        </RadioGroup>
                                    </div>
                                );
                            case "checkbox":
                                return (
                                    <div key={field.id} className="grid gap-3">
                                        <Label>
                                            {field.label}
                                            {field.required && <span className="text-red-500 ml-1">*</span>}
                                        </Label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            {field.options?.map((option) => (
                                                <div key={option} className="flex items-center space-x-2">
                                                    <Checkbox id={`${field.id}-${option}`} />
                                                    <Label htmlFor={`${field.id}-${option}`} className="font-normal">{option}</Label>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            default:
                                return null;
                        }
                    })}
                </div>
                
                <div className="pt-6 border-t flex justify-end">
                    <Button disabled>Submit Form (Preview)</Button>
                </div>
            </div>
        </ScrollArea>
    );
}

export function FormPreviewDialog({ form, open, onOpenChange }: { form: FormTemplate, open: boolean, onOpenChange: (open: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
                <DialogHeader className="p-6 pb-2">
                    <DialogTitle>Preview Form: {form.title}</DialogTitle>
                    <DialogDescription>
                        This is how the form will appear to the client.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-hidden p-6 pt-0 bg-muted/10">
                    <FormPreview form={form} />
                </div>
                <DialogFooter className="p-6 pt-2 border-t bg-background">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Close Preview</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
