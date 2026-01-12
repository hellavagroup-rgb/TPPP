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
import { CheckCircle2, Clock, AlertTriangle, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Task } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export default function Tasks() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    description: "",
    assignee: "",
    priority: "Medium" as "High" | "Medium" | "Low",
    dueDate: "",
  });

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const createTaskMutation = useMutation({
    mutationFn: async (task: typeof newTask) => {
      const response = await apiRequest("POST", "/api/tasks", {
        ...task,
        status: "Pending",
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task Created", description: "New task has been added." });
      setIsAddOpen(false);
      setNewTask({ title: "", description: "", assignee: "", priority: "Medium", dueDate: "" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create task.", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const response = await apiRequest("PATCH", `/api/tasks/${id}`, { status });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Task Management</h2>
          <p className="text-muted-foreground mt-1">Assignments for Sarah, Rosie, and Suzanne.</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)} data-testid="button-add-task">
          <Plus className="h-4 w-4 mr-2" />
          Add Task
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {["Pending", "In Progress", "Completed"].map((status) => (
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
                      <span>Due: {task.dueDate}</span>
                    </div>

                    {status !== "Completed" && (
                      <div className="pt-2 flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-xs w-full bg-secondary/50 hover:bg-secondary"
                          onClick={() => updateTaskMutation.mutate({ 
                            id: task.id, 
                            status: status === "Pending" ? "In Progress" : "Completed" 
                          })}
                          data-testid={`button-update-task-${task.id}`}
                        >
                          {status === "Pending" ? "Start" : "Complete"}
                        </Button>
                      </div>
                    )}
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
              <Input 
                type="date"
                value={newTask.dueDate}
                onChange={(e) => setNewTask({...newTask, dueDate: e.target.value})}
                data-testid="input-task-duedate"
              />
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
    </div>
  );
}
