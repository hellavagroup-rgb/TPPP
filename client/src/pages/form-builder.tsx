import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FormTemplate, FormField } from "@/lib/mockData";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { 
  ArrowLeft, 
  Save, 
  Plus, 
  Trash2, 
  GripVertical, 
  Type, 
  List, 
  CheckSquare, 
  Calendar as CalendarIcon, 
  Heading, 
  Info,
  Smartphone,
  Mail,
  Eye,
  Settings
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FormPreview } from "@/components/forms/FormPreview";

const FIELD_TYPES = [
  { type: "text", label: "Short Text", icon: Type },
  { type: "textarea", label: "Long Text", icon: Type },
  { type: "select", label: "Dropdown", icon: List },
  { type: "radio", label: "Single Choice", icon: CheckSquare },
  { type: "checkbox", label: "Multiple Choice", icon: CheckSquare },
  { type: "date", label: "Date", icon: CalendarIcon },
  { type: "email", label: "Email", icon: Mail },
  { type: "tel", label: "Phone", icon: Smartphone },
  { type: "availability", label: "Availability Picker", icon: CalendarIcon },
  { type: "section", label: "Section Header", icon: Heading },
  { type: "info", label: "Info Text", icon: Info },
];

function SortableField({ 
  field, 
  selectedFieldId, 
  setSelectedFieldId, 
  removeField 
}: { 
  field: FormField, 
  selectedFieldId: string | null, 
  setSelectedFieldId: (id: string) => void,
  removeField: (id: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
    opacity: isDragging ? 0.5 : 1
  };

  return (
    <div 
      ref={setNodeRef}
      style={style}
      onClick={() => setSelectedFieldId(field.id)}
      className={`group relative p-4 rounded-lg border transition-all cursor-pointer ${
        selectedFieldId === field.id 
        ? "bg-background border-primary shadow-sm ring-1 ring-primary" 
        : "bg-background border-border hover:border-primary/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <div 
          className="mt-1 text-muted-foreground cursor-grab active:cursor-grabbing outline-none"
          {...attributes} 
          {...listeners}
        >
            <GripVertical className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
        {field.type === "section" ? (
            <h3 className="font-semibold text-lg text-primary">{field.label}</h3>
        ) : field.type === "info" ? (
            <div className="space-y-1">
                <h4 className="font-medium text-sm">{field.label}</h4>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{field.content || "Enter information text..."}</p>
            </div>
        ) : (
            <div className="space-y-2 pointer-events-none">
                <Label className="font-medium flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
                </Label>
                
                {(field.type === "text" || field.type === "email" || field.type === "tel") && (
                <Input disabled placeholder={field.placeholder || "Answer..."} />
                )}
                {field.type === "textarea" && (
                <Textarea disabled placeholder={field.placeholder || "Long answer..."} className="min-h-[80px]" />
                )}
                {(field.type === "select") && (
                <Select disabled>
                    <SelectTrigger><SelectValue placeholder="Select an option" /></SelectTrigger>
                </Select>
                )}
                {(field.type === "radio" || field.type === "checkbox") && (
                <div className="space-y-2">
                    {field.options?.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className={`h-4 w-4 border rounded ${field.type === "radio" ? "rounded-full" : "rounded-sm"}`} />
                        <span className="text-sm text-muted-foreground">{opt}</span>
                    </div>
                    ))}
                </div>
                )}
                {field.type === "date" && (
                <Button variant="outline" disabled className="w-full justify-start text-muted-foreground font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" /> Pick a date
                </Button>
                )}
            </div>
        )}
        </div>
        
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => { e.stopPropagation(); removeField(field.id); }}>
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
            </Button>
        </div>
      </div>
    </div>
  );
}

export default function FormBuilder() {
  const [, params] = useRoute("/forms/:id");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const isNew = params?.id === "new";
  const [activeTab, setActiveTab] = useState("builder");
  
  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Fetch existing form data from API
  const { data: existingForm } = useQuery<FormTemplate>({
    queryKey: [`/api/forms/${params?.id}`],
    enabled: !isNew && !!params?.id,
  });

  // Mutation for creating new forms
  const createFormMutation = useMutation({
    mutationFn: async (formData: { title: string; description: string; fields: FormField[] }) => {
      const response = await apiRequest("POST", "/api/forms", formData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms"] });
      toast({ title: "Form Created", description: "New form template saved successfully." });
      setLocation("/forms");
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create form.", variant: "destructive" });
    },
  });

  // Mutation for updating existing forms
  const updateFormMutation = useMutation({
    mutationFn: async ({ id, formData }: { id: string; formData: { title: string; description: string; fields: FormField[] } }) => {
      const response = await apiRequest("PATCH", `/api/forms/${id}`, formData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/forms"] });
      toast({ title: "Form Updated", description: "Form template changes saved." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update form.", variant: "destructive" });
    },
  });

  // DnD Sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setFields((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  // Load existing form data (only on initial load, not after saves)
  useEffect(() => {
    if (!isNew && existingForm && !isInitialized) {
      setTitle(existingForm.title);
      setDescription(existingForm.description);
      setFields(JSON.parse(JSON.stringify(existingForm.fields))); // Deep copy
      setIsInitialized(true);
    }
  }, [isNew, existingForm, isInitialized]);

  const handleSave = () => {
    if (!title.trim()) {
      toast({
        title: "Validation Error",
        description: "Form title is required.",
        variant: "destructive"
      });
      return;
    }

    const formData = { title, description, fields };

    if (isNew) {
      createFormMutation.mutate(formData);
    } else {
      updateFormMutation.mutate({ id: params!.id!, formData });
    }
  };

  const addField = (type: FormField["type"]) => {
    const newField: FormField = {
      id: `field-${Date.now()}`,
      type,
      label: type === "section" ? "New Section" : type === "info" ? "Information" : "New Question",
      required: false,
      placeholder: "",
      options: ["Option 1", "Option 2"] // Default options for choice fields
    };
    
    setFields([...fields, newField]);
    setSelectedFieldId(newField.id);
  };

  const removeField = (id: string) => {
    setFields(fields.filter(f => f.id !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
  };

  const updateField = (id: string, updates: Partial<FormField>) => {
    setFields(fields.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const selectedField = fields.find(f => f.id === selectedFieldId);

  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between border-b pb-4 mb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/forms")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold font-serif">{isNew ? "Create New Form" : "Edit Form"}</h1>
            <p className="text-sm text-muted-foreground">{isNew ? "Design a new intake form" : `Editing: ${title}`}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <Tabs value={activeTab} onValueChange={setActiveTab} className="mr-4">
            <TabsList>
                <TabsTrigger value="builder" className="gap-2"><Settings className="h-4 w-4" /> Builder</TabsTrigger>
                <TabsTrigger value="preview" className="gap-2"><Eye className="h-4 w-4" /> Preview</TabsTrigger>
            </TabsList>
           </Tabs>
          <Button onClick={handleSave} className="gap-2">
            <Save className="h-4 w-4" />
            Save Form
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden gap-6">
        
        {activeTab === "preview" ? (
             <div className="flex-1 flex justify-center bg-muted/20 rounded-lg border p-8 overflow-y-auto">
                <div className="w-full max-w-2xl bg-white shadow-sm rounded-lg border p-8 h-fit">
                    <FormPreview form={{ id: "preview", title, description, fields }} />
                </div>
             </div>
        ) : (
            <>
                {/* Left Sidebar - Toolbox */}
                <div className="w-64 flex flex-col gap-4 overflow-y-auto pr-2">
                <Card>
                    <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">Form Elements</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-2">
                    {FIELD_TYPES.map((item) => (
                        <Button 
                        key={item.type} 
                        variant="outline" 
                        className="justify-start gap-2 h-auto py-3 font-normal"
                        onClick={() => addField(item.type as any)}
                        >
                        <item.icon className="h-4 w-4 text-muted-foreground" />
                        {item.label}
                        </Button>
                    ))}
                    </CardContent>
                </Card>

                <Card className="border-amber-200 bg-amber-50/50">
                    <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-amber-800">Debug: All Fields ({fields.length})</CardTitle>
                    <p className="text-xs text-amber-600">Use this to find and remove hidden/corrupted fields</p>
                    </CardHeader>
                    <CardContent className="space-y-2 max-h-64 overflow-y-auto">
                    {fields.map((field, index) => (
                        <div key={field.id} className="text-xs p-2 bg-white rounded border flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-amber-700">#{index + 1}</div>
                            <div className="truncate"><strong>Type:</strong> {field.type || "MISSING"}</div>
                            <div className="truncate"><strong>Label:</strong> {field.label || "(empty)"}</div>
                            <div className="truncate text-muted-foreground"><strong>ID:</strong> {field.id}</div>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                            onClick={() => removeField(field.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                    ))}
                    {fields.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-2">No fields</p>
                    )}
                    </CardContent>
                </Card>
                </div>

                {/* Center Canvas */}
                <div className="flex-1 bg-muted/20 rounded-lg border flex flex-col overflow-hidden">
                <div className="p-4 border-b bg-background/50 backdrop-blur-sm sticky top-0 z-10">
                    <Input 
                    className="text-lg font-bold border-transparent hover:border-border focus:border-primary px-2 h-auto py-1 mb-2 bg-transparent" 
                    placeholder="Form Title" 
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    />
                    <Textarea 
                    className="text-sm text-muted-foreground border-transparent hover:border-border focus:border-primary px-2 py-1 min-h-[40px] resize-none bg-transparent" 
                    placeholder="Form Description (optional)" 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    />
                </div>
                
                <ScrollArea className="flex-1 p-6">
                    <div className="max-w-2xl mx-auto space-y-4 pb-12">
                    {fields.length === 0 && (
                        <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                        <p>Click an element from the left sidebar to add it to your form.</p>
                        </div>
                    )}

                    <DndContext 
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleDragEnd}
                    >
                      <SortableContext 
                        items={fields.map(f => f.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {fields.map((field) => (
                          <SortableField 
                            key={field.id}
                            field={field}
                            selectedFieldId={selectedFieldId}
                            setSelectedFieldId={setSelectedFieldId}
                            removeField={removeField}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                    </div>
                </ScrollArea>
                </div>

                {/* Right Sidebar - Properties */}
                <div className="w-80 border-l bg-background overflow-y-auto">
                {selectedField ? (
                    <div className="p-4 space-y-6">
                    <div>
                        <h3 className="font-semibold mb-1">Edit Field</h3>
                        <p className="text-xs text-muted-foreground">ID: {selectedField.id}</p>
                    </div>
                    
                    <div className="space-y-4">
                        <div className="space-y-2">
                        <Label>Label / Question</Label>
                        <Input 
                            value={selectedField.label} 
                            onChange={(e) => updateField(selectedField.id, { label: e.target.value })}
                        />
                        </div>

                        {selectedField.type === "info" && (
                             <div className="space-y-2">
                                <Label>Content</Label>
                                <Textarea 
                                    value={selectedField.content || ""} 
                                    onChange={(e) => updateField(selectedField.id, { content: e.target.value })}
                                    className="min-h-[150px]"
                                />
                            </div>
                        )}
                        
                        {selectedField.type !== "section" && selectedField.type !== "info" && (
                        <>
                            <div className="space-y-2">
                            <Label>Placeholder</Label>
                            <Input 
                                value={selectedField.placeholder || ""} 
                                onChange={(e) => updateField(selectedField.id, { placeholder: e.target.value })}
                            />
                            </div>
                            
                            <div className="flex items-center justify-between">
                            <Label>Required Field</Label>
                            <Switch 
                                checked={selectedField.required}
                                onCheckedChange={(checked) => updateField(selectedField.id, { required: checked })}
                            />
                            </div>
                        </>
                        )}
                        
                        {(selectedField.type === "select" || selectedField.type === "radio" || selectedField.type === "checkbox") && (
                        <div className="space-y-3 pt-2 border-t">
                            <Label>Options</Label>
                            <div className="space-y-2">
                            {selectedField.options?.map((option, index) => (
                                <div key={index} className="flex gap-2">
                                <Input 
                                    value={option}
                                    onChange={(e) => {
                                    const newOptions = [...(selectedField.options || [])];
                                    newOptions[index] = e.target.value;
                                    updateField(selectedField.id, { options: newOptions });
                                    }}
                                />
                                <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => {
                                    const newOptions = selectedField.options?.filter((_, i) => i !== index);
                                    updateField(selectedField.id, { options: newOptions });
                                    }}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                </div>
                            ))}
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="w-full"
                                onClick={() => {
                                const newOptions = [...(selectedField.options || []), `Option ${(selectedField.options?.length || 0) + 1}`];
                                updateField(selectedField.id, { options: newOptions });
                                }}
                            >
                                <Plus className="h-3 w-3 mr-2" /> Add Option
                            </Button>
                            </div>
                        </div>
                        )}
                    </div>
                    </div>
                ) : (
                    <div className="p-8 text-center text-muted-foreground h-full flex flex-col items-center justify-center">
                    <Settings className="h-10 w-10 mb-4 opacity-20" />
                    <p>Select a field on the canvas to edit its properties.</p>
                    </div>
                )}
                </div>
            </>
        )}
      </div>
    </div>
  );
}
