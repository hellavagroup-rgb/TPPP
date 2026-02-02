import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CheckCircle2, Clock, AlertTriangle, Plus, Pencil, Trash2, Calendar as CalendarIcon, MessageSquare } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { formatDateUK } from "@/lib/dateUtils";
import { format, parse } from "date-fns";
import { cn } from "@/lib/utils";

export default function Tasks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    assignee: "",
    priority: "Medium" as "High" | "Medium" | "Low",
    dueDate: undefined as Date | undefined,
  });
  const [editTask, setEditTask] = useState({
    title: "",
    description: "",
    assignee: "",
    priority: "Medium" as "High" | "Medium" | "Low",
    dueDate: undefined as Date | undefined,
    status: "Pending" as string,
    comments: "",
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const createTaskMutation = useMutation({
    mutationFn: async (task: typeof newTask) => {
      const response = await apiRequest("POST", "/api/tasks", {
        title: task.title,
        description: task.description || "",
        assignee: task.assignee,
        priority: task.priority,
        dueDate: task.dueDate ? task.dueDate.toISOString() : new Date().toISOString(),
        status: "Pending",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task Created", description: "New task has been added." });
      setIsAddOpen(false);
      setNewTask({ title: "", description: "", assignee: "", priority: "Medium", dueDate: undefined });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create task.", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const response = await apiRequest("PATCH", `/api/tasks/${id}`, updates);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task Updated", description: "Task has been updated." });
      setIsEditOpen(false);
      setSelectedTask(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update task.", variant: "destructive" });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `/api/tasks/${id}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task Deleted", description: "Task has been removed." });
      setIsDeleteOpen(false);
      setSelectedTask(null);
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete task.", variant: "destructive" });
    },
  });

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "High": return "text-destructive bg-destructive/10 border-destructive/20";
      case "Medium": return "text-amber-600 bg-amber-100 border-amber-200";
      case "Low": return "text-slate-600 bg-slate-100 border-slate-200";
      default: return "text-slate-600 bg-slate-100";
    }
  };

  const handleAddTask = () => {
    if (!newTask.title || !newTask.assignee) {
      toast({ title: "Missing fields", description: "Please fill in title and assignee.", variant: "destructive" });
      return;
    }
    createTaskMutation.mutate(newTask);
  };

  const handleEditClick = (task: Task) => {
    setSelectedTask(task);
    setEditTask({
      title: task.title,
      description: task.description || "",
      assignee: task.assignee,
      priority: task.priority as "High" | "Medium" | "Low",
      dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
      status: task.status,
      comments: (task as any).comments || "",
    });
    setIsEditOpen(true);
  };

  const handleDeleteClick = (task: Task) => {
    setSelectedTask(task);
    setIsDeleteOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedTask) return;
    if (!editTask.title || !editTask.assignee) {
      toast({ title: "Missing fields", description: "Please fill in title and assignee.", variant: "destructive" });
      return;
    }
    updateTaskMutation.mutate({
      id: selectedTask.id,
      updates: {
        title: editTask.title,
        description: editTask.description,
        assignee: editTask.assignee,
        priority: editTask.priority,
        dueDate: editTask.dueDate?.toISOString(),
        status: editTask.status,
        comments: editTask.comments,
      },
    });
  };

  const handleConfirmDelete = () => {
    if (!selectedTask) return;
    deleteTaskMutation.mutate(selectedTask.id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Task Management</h2>
          <p className="text-muted-foreground mt-1">Assignments for Sarah, Rosie, and Suzanne.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="show-completed" className="text-sm text-muted-foreground cursor-pointer">Show Completed</Label>
            <Switch 
              id="show-completed" 
              checked={showCompleted} 
              onCheckedChange={setShowCompleted}
              data-testid="toggle-show-completed"
            />
          </div>
          <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-task">
            <Plus className="h-4 w-4 mr-2" />
            Add Task
          </Button>
        </div>
      </div>

      <div className={`grid gap-6 ${showCompleted ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
        {(showCompleted ? ["Pending", "In Progress", "Completed"] : ["Pending", "In Progress"]).map((status) => (
          <div key={status} className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-lg flex items-center gap-2">
                {status === "Pending" && <Clock className="h-4 w-4 text-amber-500" />}
                {status === "In Progress" && <AlertTriangle className="h-4 w-4 text-blue-500" />}
                {status === "Completed" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                {status}
              </h3>
              <Badge variant="secondary" className="rounded-full px-2">
                {tasks.filter(t => t.status === status).length}
              </Badge>
            </div>
            
            <div className="space-y-3">
              {tasks.filter(t => t.status === status).map((task) => (
                <Card key={task.id} className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-transparent hover:border-l-primary" data-testid={`card-task-${task.id}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex justify-between items-start gap-2">
                      <p className="font-medium text-sm leading-tight">{task.title}</p>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 border ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </Badge>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-secondary-foreground">
                          {task.assignee?.charAt(0) || "?"}
                        </div>
                        <span>{task.assignee}</span>
                      </div>
                      <span>Due: {formatDateUK(task.dueDate)}</span>
                    </div>

                    {(task as any).comments && (
                      <div className="mt-2 p-2 bg-muted/50 rounded-md text-xs text-muted-foreground border-l-2 border-primary/30">
                        <div className="flex items-start gap-1">
                          <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" />
                          <span className="italic">"{(task as any).comments}"</span>
                        </div>
                      </div>
                    )}

                    <div className="pt-2 flex gap-2">
                      {status !== "Completed" && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs flex-1 bg-secondary/50 hover:bg-secondary"
                          onClick={() => updateTaskMutation.mutate({ 
                            id: task.id, 
                            updates: { status: status === "Pending" ? "In Progress" : "Completed" }
                          })}
                          data-testid={`button-update-task-${task.id}`}
                        >
                          {status === "Pending" ? "Start" : "Complete"}
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 w-7 p-0"
                        onClick={() => handleEditClick(task)}
                        data-testid={`button-edit-task-${task.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDeleteClick(task)}
                        data-testid={`button-delete-task-${task.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              
              {tasks.filter(t => t.status === status).length === 0 && (
                <div className="h-24 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
                  No tasks
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Task Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Task</DialogTitle>
            <DialogDescription>Create a new task for your team.</DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Task Title</Label>
              <Input 
                value={newTask.title}
                onChange={(e) => setNewTask({...newTask, title: e.target.value})}
                placeholder="e.g., Follow up with client W12345"
                data-testid="input-task-title"
              />
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea 
                value={newTask.description}
                onChange={(e) => setNewTask({...newTask, description: e.target.value})}
                placeholder="Additional details..."
                data-testid="input-task-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assignee</Label>
                <Select value={newTask.assignee} onValueChange={(v) => setNewTask({...newTask, assignee: v})}>
                  <SelectTrigger data-testid="select-task-assignee">
                    <SelectValue placeholder="Select assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Sarah">Sarah</SelectItem>
                    <SelectItem value="Rosie">Rosie</SelectItem>
                    <SelectItem value="Suzanne">Suzanne</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={newTask.priority} onValueChange={(v: "High" | "Medium" | "Low") => setNewTask({...newTask, priority: v})}>
                  <SelectTrigger data-testid="select-task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Due Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !newTask.dueDate && "text-muted-foreground"
                    )}
                    data-testid="input-task-duedate"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {newTask.dueDate ? format(newTask.dueDate, "dd/MM/yyyy") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={newTask.dueDate}
                    onSelect={(date) => setNewTask({...newTask, dueDate: date})}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button onClick={handleAddTask} disabled={createTaskMutation.isPending} data-testid="button-submit-task">
              {createTaskMutation.isPending ? "Creating..." : "Create Task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
            <DialogDescription>Update task details.</DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Task Title</Label>
              <Input 
                value={editTask.title}
                onChange={(e) => setEditTask({...editTask, title: e.target.value})}
                placeholder="e.g., Follow up with client W12345"
                data-testid="input-edit-task-title"
              />
            </div>

            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Textarea 
                value={editTask.description}
                onChange={(e) => setEditTask({...editTask, description: e.target.value})}
                placeholder="Additional details..."
                data-testid="input-edit-task-description"
              />
            </div>

            <div className="space-y-2">
              <Label>Comments / Progress Notes</Label>
              <Textarea 
                value={editTask.comments}
                onChange={(e) => setEditTask({...editTask, comments: e.target.value})}
                placeholder="Add notes about task progress, updates, or any issues..."
                className="min-h-[80px]"
                data-testid="input-edit-task-comments"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Assignee</Label>
                <Select value={editTask.assignee} onValueChange={(v) => setEditTask({...editTask, assignee: v})}>
                  <SelectTrigger data-testid="select-edit-task-assignee">
                    <SelectValue placeholder="Select assignee" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Sarah">Sarah</SelectItem>
                    <SelectItem value="Rosie">Rosie</SelectItem>
                    <SelectItem value="Suzanne">Suzanne</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Priority</Label>
                <Select value={editTask.priority} onValueChange={(v: "High" | "Medium" | "Low") => setEditTask({...editTask, priority: v})}>
                  <SelectTrigger data-testid="select-edit-task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editTask.status} onValueChange={(v) => setEditTask({...editTask, status: v})}>
                  <SelectTrigger data-testid="select-edit-task-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="In Progress">In Progress</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !editTask.dueDate && "text-muted-foreground"
                      )}
                      data-testid="input-edit-task-duedate"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {editTask.dueDate ? format(editTask.dueDate, "dd/MM/yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={editTask.dueDate}
                      onSelect={(date) => setEditTask({...editTask, dueDate: date})}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updateTaskMutation.isPending} data-testid="button-save-edit-task">
              {updateTaskMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedTask?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleConfirmDelete} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-task"
            >
              {deleteTaskMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
