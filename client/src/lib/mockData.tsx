import { createContext, useContext, useState, ReactNode } from "react";
import { format, subDays, addDays } from "date-fns";

// Types
export type ClientStatus = "New" | "Forms Sent" | "Forms Completed" | "Assigned" | "Scheduled" | "Waitlist";

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: ClientStatus;
  intakeDate: string;
  assignedClinicianId?: string;
  presentingIssues: string[];
  notes: string;
}

export interface Clinician {
  id: string;
  name: string;
  specialties: string[];
  capacity: number;
  currentLoad: number;
  avatar: string;
  availability: string[];
}

export type TaskPriority = "High" | "Medium" | "Low";
export type TaskStatus = "Pending" | "In Progress" | "Completed";

export interface Task {
  id: string;
  title: string;
  assignee: "Sarah" | "Rosie" | "Suzanne";
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  relatedClientId?: string;
}

// Mock Data
const MOCK_CLINICIANS: Clinician[] = [
  {
    id: "c1",
    name: "Dr. Emily Chen",
    specialties: ["Anxiety", "Depression", "CBT"],
    capacity: 25,
    currentLoad: 22,
    avatar: "EC",
    availability: ["Mon", "Wed", "Fri"]
  },
  {
    id: "c2",
    name: "Mark Wilson, LMFT",
    specialties: ["Couples", "Family Systems", "Trauma"],
    capacity: 20,
    currentLoad: 12,
    avatar: "MW",
    availability: ["Tue", "Thu", "Sat"]
  },
  {
    id: "c3",
    name: "Sarah Johnson, LCSW",
    specialties: ["Adolescents", "Eating Disorders"],
    capacity: 22,
    currentLoad: 20,
    avatar: "SJ",
    availability: ["Mon", "Tue", "Thu", "Fri"]
  },
  {
    id: "c4",
    name: "Dr. Robert Fox",
    specialties: ["PTSD", "EMDR", "Veterans"],
    capacity: 15,
    currentLoad: 5,
    avatar: "RF",
    availability: ["Wed", "Thu"]
  }
];

const MOCK_CLIENTS: Client[] = [
  {
    id: "cl1",
    name: "Alice Thompson",
    email: "alice.t@example.com",
    phone: "555-0101",
    status: "New",
    intakeDate: format(new Date(), "yyyy-MM-dd"),
    presentingIssues: ["Anxiety", "Work Stress"],
    notes: "Prefer evening appointments."
  },
  {
    id: "cl2",
    name: "James Rodriguez",
    email: "j.rodriguez@example.com",
    phone: "555-0102",
    status: "Forms Sent",
    intakeDate: format(subDays(new Date(), 2), "yyyy-MM-dd"),
    presentingIssues: ["Depression"],
    notes: "Sent intake forms via email."
  },
  {
    id: "cl3",
    name: "Maria Garcia",
    email: "m.garcia@example.com",
    phone: "555-0103",
    status: "Forms Completed",
    intakeDate: format(subDays(new Date(), 5), "yyyy-MM-dd"),
    presentingIssues: ["Couples Therapy", "Communication"],
    notes: "Ready for assignment."
  },
  {
    id: "cl4",
    name: "Sam Smith",
    email: "sam.smith@example.com",
    phone: "555-0104",
    status: "Assigned",
    intakeDate: format(subDays(new Date(), 7), "yyyy-MM-dd"),
    assignedClinicianId: "c1",
    presentingIssues: ["Anxiety"],
    notes: "Assigned to Dr. Chen."
  },
  {
    id: "cl5",
    name: "Linda Brown",
    email: "linda.b@example.com",
    phone: "555-0105",
    status: "Waitlist",
    intakeDate: format(subDays(new Date(), 10), "yyyy-MM-dd"),
    presentingIssues: ["Specific Phobia"],
    notes: "Waiting for weekend availability."
  }
];

const MOCK_TASKS: Task[] = [
  {
    id: "t1",
    title: "Send intake forms to Alice",
    assignee: "Sarah",
    dueDate: format(new Date(), "yyyy-MM-dd"),
    priority: "High",
    status: "Pending",
    relatedClientId: "cl1"
  },
  {
    id: "t2",
    title: "Follow up with James on insurance",
    assignee: "Rosie",
    dueDate: format(addDays(new Date(), 1), "yyyy-MM-dd"),
    priority: "Medium",
    status: "Pending",
    relatedClientId: "cl2"
  },
  {
    id: "t3",
    title: "Schedule initial consult for Maria",
    assignee: "Suzanne",
    dueDate: format(new Date(), "yyyy-MM-dd"),
    priority: "High",
    status: "Pending",
    relatedClientId: "cl3"
  }
];

// Context
interface DataContextType {
  clients: Client[];
  clinicians: Clinician[];
  tasks: Task[];
  addClient: (client: Client) => void;
  updateClientStatus: (id: string, status: ClientStatus) => void;
  assignClinician: (clientId: string, clinicianId: string) => void;
  addTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const [clients, setClients] = useState<Client[]>(MOCK_CLIENTS);
  const [clinicians, setClinicians] = useState<Clinician[]>(MOCK_CLINICIANS);
  const [tasks, setTasks] = useState<Task[]>(MOCK_TASKS);

  const addClient = (client: Client) => {
    setClients(prev => [client, ...prev]);
  };

  const updateClientStatus = (id: string, status: ClientStatus) => {
    setClients(prev => prev.map(c => c.id === id ? { ...c, status } : c));
  };

  const assignClinician = (clientId: string, clinicianId: string) => {
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, status: "Assigned", assignedClinicianId: clinicianId } : c));
    setClinicians(prev => prev.map(c => c.id === clinicianId ? { ...c, currentLoad: c.currentLoad + 1 } : c));
  };

  const addTask = (task: Task) => {
    setTasks(prev => [task, ...prev]);
  };

  const updateTaskStatus = (id: string, status: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  return (
    <DataContext.Provider value={{ clients, clinicians, tasks, addClient, updateClientStatus, assignClinician, addTask, updateTaskStatus }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error("useData must be used within a DataProvider");
  }
  return context;
}
