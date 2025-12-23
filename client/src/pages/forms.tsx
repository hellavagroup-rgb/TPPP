import { useData } from "@/lib/mockData";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Eye, FileText, MoreHorizontal } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { FormPreviewDialog } from "@/components/forms/FormPreview";

export default function Forms() {
  const { forms, deleteForm } = useData();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const handleDelete = () => {
    if (deleteId) {
      deleteForm(deleteId);
      setDeleteId(null);
      toast({
        title: "Form Deleted",
        description: "The form template has been permanently removed.",
      });
    }
  };

  const previewForm = forms.find(f => f.id === previewId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Form Templates</h2>
          <p className="text-muted-foreground mt-1">Manage intake forms and assessments sent to clients.</p>
        </div>
        
        <Button onClick={() => setLocation("/forms/new")} className="gap-2">
            <Plus className="h-4 w-4" />
            Create Form
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {forms.map((form) => (
          <Card key={form.id} className="group hover:shadow-md transition-all">
            <CardHeader className="pb-4">
              <div className="flex justify-between items-start">
                <div className="p-2 bg-primary/5 rounded-md text-primary mb-2 inline-flex">
                  <FileText className="h-6 w-6" />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="-mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setLocation(`/forms/${form.id}`)}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setPreviewId(form.id)}>
                      <Eye className="h-4 w-4 mr-2" /> Preview
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(form.id)}>
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <CardTitle className="text-xl">{form.title}</CardTitle>
              <CardDescription className="line-clamp-2 mt-2 h-10">
                {form.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                {form.fields.length} questions
              </div>
            </CardContent>
            <CardFooter className="pt-0 flex gap-2">
                <Button variant="outline" className="w-full" onClick={() => setPreviewId(form.id)}>
                    Preview
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => setLocation(`/forms/${form.id}`)}>
                    Edit
                </Button>
            </CardFooter>
          </Card>
        ))}
        
        {/* Create New Card Placeholder */}
        <div 
            className="border-2 border-dashed border-muted-foreground/20 rounded-lg flex flex-col items-center justify-center p-8 text-center hover:bg-muted/50 transition-colors cursor-pointer min-h-[250px]"
            onClick={() => setLocation("/forms/new")}
        >
            <div className="p-4 bg-muted rounded-full mb-4">
                <Plus className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg">Create New Form</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-[200px]">Start from scratch to build a custom intake or assessment.</p>
        </div>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will permanently delete this form template. This action cannot be undone.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                    Delete Form
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {previewForm && (
        <FormPreviewDialog 
            form={previewForm} 
            open={!!previewId} 
            onOpenChange={(open) => !open && setPreviewId(null)} 
        />
      )}
    </div>
  );
}
