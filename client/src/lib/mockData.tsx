import { createContext, useContext, useState, ReactNode } from "react";
import { format, subDays, addDays } from "date-fns";

// Types
export type ClientStatus = "New" | "Forms Sent" | "Forms Completed" | "Assigned" | "Scheduled" | "Waitlist";

export interface Client {
  id: string; // Internal ID
  displayId: string; // The W12345678 format
  email: string; // Hidden from display
  status: ClientStatus;
  intakeDate: string;
  assignedClinicianId?: string;
  assignedSlot?: string; // e.g., "Mon 10:00 AM"
  presentingIssues: string[];
  notes: string;
}

export interface TimeSlot {
  id: string;
  day: string;
  startTime: string;
  endTime: string;
  isBooked: boolean;
}

export interface Clinician {
  id: string;
  name: string;
  specialties: string[];
  capacity: number;
  currentLoad: number;
  avatar: string;
  availability: TimeSlot[];
  lastUpdatedAvailability?: string;
}

export type TaskPriority = "High" | "Medium" | "Low";
export type TaskStatus = "Pending" | "In Progress" | "Completed";

export interface Task {
  id: string;
  title: string;
  description: string; // "What needs to be done next"
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
    availability: [
      { id: "ts1", day: "Monday", startTime: "10:00", endTime: "15:00", isBooked: true },
      { id: "ts2", day: "Wednesday", startTime: "10:00", endTime: "15:00", isBooked: false },
      { id: "ts3", day: "Friday", startTime: "09:00", endTime: "13:00", isBooked: false }
    ],
    lastUpdatedAvailability: format(subDays(new Date(), 2), "MMM d")
  },
  {
    id: "c2",
    name: "Mark Wilson, LMFT",
    specialties: ["Couples", "Family Systems", "Trauma"],
    capacity: 20,
    currentLoad: 12,
    avatar: "MW",
    availability: [
      { id: "ts4", day: "Tuesday", startTime: "13:00", endTime: "16:00", isBooked: false },
      { id: "ts5", day: "Thursday", startTime: "13:00", endTime: "16:00", isBooked: false },
      { id: "ts6", day: "Saturday", startTime: "10:00", endTime: "14:00", isBooked: false }
    ],
    lastUpdatedAvailability: format(subDays(new Date(), 5), "MMM d")
  },
  {
    id: "c3",
    name: "Sarah Johnson, LCSW",
    specialties: ["Adolescents", "Eating Disorders"],
    capacity: 22,
    currentLoad: 20,
    avatar: "SJ",
    availability: [
      { id: "ts7", day: "Monday", startTime: "09:00", endTime: "17:00", isBooked: true },
      { id: "ts8", day: "Tuesday", startTime: "09:00", endTime: "17:00", isBooked: true }
    ],
    lastUpdatedAvailability: format(subDays(new Date(), 10), "MMM d") // Needs reminder!
  }
];

const MOCK_CLIENTS: Client[] = [
  {
    id: "cl1",
    displayId: "W83920192",
    email: "redacted@example.com",
    status: "New",
    intakeDate: format(new Date(), "yyyy-MM-dd"),
    presentingIssues: ["Anxiety", "Work Stress"],
    notes: "Requires evening slots."
  },
  {
    id: "cl2",
    displayId: "W92837102",
    email: "redacted@example.com",
    status: "Forms Sent",
    intakeDate: format(subDays(new Date(), 2), "yyyy-MM-dd"),
    presentingIssues: ["Depression"],
    notes: "Waiting on insurance details."
  },
  {
    id: "cl3",
    displayId: "W73829103",
    email: "redacted@example.com",
    status: "Forms Completed",
    intakeDate: format(subDays(new Date(), 5), "yyyy-MM-dd"),
    presentingIssues: ["Couples Therapy", "Communication"],
    notes: "Ready for allocation. Needs calm demeanor."
  },
  {
    id: "cl4",
    displayId: "W12039482",
    email: "redacted@example.com",
    status: "Assigned",
    intakeDate: format(subDays(new Date(), 7), "yyyy-MM-dd"),
    assignedClinicianId: "c1",
    assignedSlot: "Monday 14:00",
    presentingIssues: ["Anxiety"],
    notes: "Allocated to Dr. Chen."
  },
  {
    id: "cl5",
    displayId: "W39201928",
    email: "redacted@example.com",
    status: "Waitlist",
    intakeDate: format(subDays(new Date(), 10), "yyyy-MM-dd"),
    presentingIssues: ["Specific Phobia"],
    notes: "Needs weekend availability."
  }
];

const MOCK_TASKS: Task[] = [
  {
    id: "t1",
    title: "Process Intake for W83920192",
    description: "Review initial inquiry and send standard intake forms packet.",
    assignee: "Sarah",
    dueDate: format(new Date(), "yyyy-MM-dd"),
    priority: "High",
    status: "Pending",
    relatedClientId: "cl1"
  },
  {
    id: "t2",
    title: "Insurance Verification W92837102",
    description: "Verify coverage with BlueCross for new depression treatment plan.",
    assignee: "Rosie",
    dueDate: format(addDays(new Date(), 1), "yyyy-MM-dd"),
    priority: "Medium",
    status: "Pending",
    relatedClientId: "cl2"
  },
  {
    id: "t3",
    title: "Allocate W73829103",
    description: "Match with couples therapist. Check Mark's availability.",
    assignee: "Suzanne",
    dueDate: format(new Date(), "yyyy-MM-dd"),
    priority: "High",
    status: "Pending",
    relatedClientId: "cl3"
  },
  {
    id: "t4",
    title: "Availability Reminder",
    description: "Remind Sarah Johnson to update her calendar for next month.",
    assignee: "Suzanne",
    dueDate: format(new Date(), "yyyy-MM-dd"),
    priority: "Low",
    status: "Pending"
  }
];

// Context
interface DataContextType {
  clients: Client[];
  clinicians: Clinician[];
  tasks: Task[];
  addClient: (client: Client) => void;
  updateClientStatus: (id: string, status: ClientStatus) => void;
  assignClinician: (clientId: string, clinicianId: string, slotId: string) => void;
  addTask: (task: Task) => void;
  updateTaskStatus: (id: string, status: TaskStatus) => void;
  updateClinicianAvailability: (clinicianId: string, slots: TimeSlot[]) => void;
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

  const assignClinician = (clientId: string, clinicianId: string, slotId: string) => {
    // 1. Update Client
    const clinician = clinicians.find(c => c.id === clinicianId);
    const slot = clinician?.availability.find(s => s.id === slotId);
    const slotString = slot ? `${slot.day} ${slot.startTime}` : "Assigned";

    setClients(prev => prev.map(c => c.id === clientId ? { 
      ...c, 
      status: "Assigned", 
      assignedClinicianId: clinicianId,
      assignedSlot: slotString
    } : c));

    // 2. Update Clinician Load and Slot Status
    setClinicians(prev => prev.map(c => {
      if (c.id === clinicianId) {
        return {
          ...c,
          currentLoad: c.currentLoad + 1,
          availability: c.availability.map(s => s.id === slotId ? { ...s, isBooked: true } : s)
        };
      }
      return c;
    }));
  };

  const addTask = (task: Task) => {
    setTasks(prev => [task, ...prev]);
  };

  const updateTaskStatus = (id: string, status: TaskStatus) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const updateClinicianAvailability = (clinicianId: string, slots: TimeSlot[]) => {
    setClinicians(prev => prev.map(c => c.id === clinicianId ? { 
      ...c, 
      availability: slots,
      lastUpdatedAvailability: format(new Date(), "MMM d")
    } : c));
  };

  return (
    <DataContext.Provider value={{ 
      clients, 
      clinicians, 
      tasks, 
      addClient, 
      updateClientStatus, 
      assignClinician, 
      addTask, 
      updateTaskStatus,
      updateClinicianAvailability 
    }}>
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
