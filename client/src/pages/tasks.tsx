import { useData } from "@/lib/mockData";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";

export default function Tasks() {
  const { tasks, updateTaskStatus } = useData();

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "High": return "text-destructive bg-destructive/10 border-destructive/20";
      case "Medium": return "text-amber-600 bg-amber-100 border-amber-200";
      case "Low": return "text-slate-600 bg-slate-100 border-slate-200";
      default: return "text-slate-600 bg-slate-100";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-serif font-bold text-foreground">Task Management</h2>
          <p className="text-muted-foreground mt-1">Assignments for Sarah, Rosie, and Suzanne.</p>
        </div>
        <Button>+ Add Task</Button>
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
                    <Card key={task.id} className="cursor-pointer hover:shadow-md transition-shadow border-l-4 border-l-transparent hover:border-l-primary">
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
                                        {task.assignee.charAt(0)}
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
                                        onClick={() => updateTaskStatus(task.id, status === "Pending" ? "In Progress" : "Completed")}
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
    </div>
  );
}
