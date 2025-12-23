import { createContext, useContext, useState, ReactNode } from "react";
import { format, subDays, addDays, isSameDay, parseISO, startOfWeek, endOfWeek, eachDayOfInterval } from "date-fns";

// Types
export type ClientStatus = "New" | "Forms Sent" | "Forms Completed" | "Assigned" | "Scheduled" | "Waitlist";

export interface Client {
  id: string; // Internal ID
  displayId: string; // The W12345678 format
  email: string; // Hidden from display
  phone?: string;
  referralSource?: string;
  status: ClientStatus;
  intakeDate: string;
  assignedClinicianId?: string;
  assignedSlot?: string; // e.g., "Mon 10:00 AM"
  presentingIssues: string[];
  notes: string;
}

export type SlotType = "Recurring" | "SpecificDate" | "Vacation";

export interface TimeSlot {
  id: string;
  type: SlotType;
  day: string; // "Monday", etc. (Used for Recurring)
  date?: string; // YYYY-MM-DD (Used for SpecificDate and Vacation)
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
  description: string;
  assignee: "Sarah" | "Rosie" | "Suzanne";
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  relatedClientId?: string;
}

export interface FormField {
  id: string;
  type: "text" | "textarea" | "date" | "select" | "radio" | "checkbox" | "email" | "tel" | "header" | "info" | "section";
  label: string;
  content?: string; // For info/header types
  options?: string[]; // For select, radio, checkbox
  required?: boolean;
  placeholder?: string;
  conditional?: {
    fieldId: string;
    value: string;
  };
}

export interface FormTemplate {
  id: string;
  title: string;
  description: string;
  fields: FormField[];
}

// Mock Data
const MOCK_FORMS: FormTemplate[] = [
    {
        id: "f1",
        title: "Therapy Enquiry Form",
        description: "Standard intake form for new clients to assess needs and risk.",
        fields: [
            {
                id: "intro",
                type: "info",
                label: "Introduction",
                content: "This form enables us to plan next steps and to ensure that we are the best fit for you. We know that finding therapeutic help is anxiety provoking and we want to make sure that you are able to move forward with confidence.\n\nThis short questionnaire usually takes around 10–15 minutes to complete and helps us understand what’s been going on for you, what kind of support you’re looking for, and how to match you with the most appropriate clinician within our practice."
            },
            {
                id: "sec1",
                type: "section",
                label: "Section 1: About You"
            },
            {
                id: "fullName",
                type: "text",
                label: "Full Name",
                required: true
            },
            {
                id: "dob",
                type: "date",
                label: "Date of Birth",
                required: true
            },
            {
                id: "pronouns",
                type: "text",
                label: "What are your preferred pronouns"
            },
            {
                id: "phone",
                type: "tel",
                label: "Telephone number",
                required: true
            },
            {
                id: "voicemail",
                type: "radio",
                label: "Is it OK to leave a voicemail?",
                options: ["Yes", "No"],
                required: true
            },
            {
                id: "email",
                type: "email",
                label: "Email address",
                required: true
            },
            {
                id: "parentingStatus",
                type: "radio",
                label: "Are you currently pregnant, postpartum, or parenting young children?",
                options: ["Pregnant", "Postpartum", "Trying to conceive / fertility journey", "Parenting young children"]
            },
            {
                id: "dueDate",
                type: "date",
                label: "If pregnant, when is your estimated due date?",
                conditional: { fieldId: "parentingStatus", value: "Pregnant" }
            },
            {
                id: "babyAge",
                type: "text",
                label: "If postnatal, how old is your baby or children?",
                conditional: { fieldId: "parentingStatus", value: "Postpartum" }
            },
            {
                id: "sec2",
                type: "section",
                label: "Section 2: Main Concerns"
            },
            {
                id: "reason",
                type: "textarea",
                label: "What has led you to seek support at this time?",
                required: true
            },
            {
                id: "difficulties",
                type: "checkbox",
                label: "Which difficulties are affecting you? (Tick all that apply)",
                options: [
                    "Anxiety or excessive worry",
                    "Low mood / depression",
                    "Birth trauma / previous trauma",
                    "Intrusive or distressing thoughts",
                    "Panic attacks",
                    "Sleep difficulties",
                    "Bonding/attachment concerns",
                    "Grief and distress following loss",
                    "Other"
                ]
            },
            {
                id: "duration",
                type: "radio",
                label: "How long have these difficulties been affecting you?",
                options: ["<2 weeks", "2-6 weeks", "6 weeks-6 months", ">6 months"]
            },
            {
                id: "additionalDetail",
                type: "textarea",
                label: "If helpful, please let us know any detail in relation to your responses above."
            },
            {
                id: "sec3",
                type: "section",
                label: "Safety and Risk"
            },
            {
                id: "harmSelf",
                type: "radio",
                label: "Thoughts of Harming Yourself",
                options: ["No", "Yes, Sometimes", "Yes, Frequently"],
                required: true
            },
            {
                id: "plans",
                type: "radio",
                label: "Any Current Plans or Intention?",
                options: ["No", "Unsure", "Yes"],
                required: true
            },
            {
                id: "selfHarm",
                type: "radio",
                label: "Recent Self-Harm",
                options: ["No", "Yes"],
                required: true
            },
            {
                id: "safetyOther",
                type: "textarea",
                label: "Is there anything else you think we should know about in relation to your safety?"
            },
            {
                id: "sec4",
                type: "section",
                label: "History"
            },
            {
                id: "prevTherapy",
                type: "radio",
                label: "Have you previously had therapy?",
                options: ["No", "Yes"]
            },
            {
                id: "prevTherapyDetails",
                type: "textarea",
                label: "Please tell us briefly about the therapy you have had previously",
                conditional: { fieldId: "prevTherapy", value: "Yes" }
            },
            {
                id: "diagnosis",
                type: "radio",
                label: "Have you ever been diagnosed with a mental health difficulty?",
                options: ["No", "Yes"]
            },
            {
                id: "diagnosisDetails",
                type: "textarea",
                label: "Can you provide us with some detail around this:",
                conditional: { fieldId: "diagnosis", value: "Yes" }
            },
            {
                id: "medication",
                type: "radio",
                label: "Are you currently prescribed any medication to support your mental health?",
                options: ["No", "Yes"]
            },
            {
                id: "medicationDetails",
                type: "textarea",
                label: "Can you provide us with some detail around this?",
                conditional: { fieldId: "medication", value: "Yes" }
            },
            {
                id: "careTeam",
                type: "radio",
                label: "Are you currently under the care of a perinatal mental health team or other NHS mental health team?",
                options: ["Yes", "No"]
            },
            {
                id: "sec5",
                type: "section",
                label: "Section 5: Practical Details"
            },
            {
                id: "availability",
                type: "textarea",
                label: "What days and times would you be available for therapy?"
            },
            {
                id: "neurodiversity",
                type: "radio",
                label: "Would you like us to be aware of any neurodiversity-related needs or adjustments?",
                options: ["Yes", "No"]
            },
            {
                id: "neurodiversityDetails",
                type: "textarea",
                label: "If yes, please let us know what you would find helpful:",
                conditional: { fieldId: "neurodiversity", value: "Yes" }
            },
            {
                id: "sec6",
                type: "section",
                label: "Section 6: Consent"
            },
            {
                id: "consent",
                type: "radio",
                label: "Do you consent to us using this information to match you with a clinician?",
                options: ["Yes", "No"],
                required: true
            }
        ]
    },
    {
        id: "f2",
        title: "GAD-7 Assessment",
        description: "Generalized Anxiety Disorder 7-item scale.",
        fields: [
            { id: "gad_intro", type: "info", label: "Instructions", content: "Over the last 2 weeks, how often have you been bothered by the following problems?" },
            { id: "gad_1", type: "radio", label: "Feeling nervous, anxious, or on edge", options: ["Not at all", "Several days", "More than half the days", "Nearly every day"] },
            { id: "gad_2", type: "radio", label: "Not being able to stop or control worrying", options: ["Not at all", "Several days", "More than half the days", "Nearly every day"] }
        ]
    },
    {
        id: "f3",
        title: "PHQ-9 Assessment",
        description: "Patient Health Questionnaire 9-item depression scale.",
        fields: [
             { id: "phq_intro", type: "info", label: "Instructions", content: "Over the last 2 weeks, how often have you been bothered by any of the following problems?" },
             { id: "phq_1", type: "radio", label: "Little interest or pleasure in doing things", options: ["Not at all", "Several days", "More than half the days", "Nearly every day"] },
             { id: "phq_2", type: "radio", label: "Feeling down, depressed, or hopeless", options: ["Not at all", "Several days", "More than half the days", "Nearly every day"] }
        ]
    }
];

const MOCK_CLINICIANS: Clinician[] = [
  {
    id: "c1",
    name: "Dr. Emily Chen",
    specialties: ["Anxiety", "Depression", "CBT"],
    capacity: 25,
    currentLoad: 22,
    avatar: "EC",
    availability: [
      { id: "ts1", type: "Recurring", day: "Monday", startTime: "10:00", endTime: "15:00", isBooked: true },
      { id: "ts2", type: "Recurring", day: "Wednesday", startTime: "10:00", endTime: "15:00", isBooked: false },
      { id: "ts3", type: "Recurring", day: "Friday", startTime: "09:00", endTime: "13:00", isBooked: false },
      // Example Vacation
      { id: "v1", type: "Vacation", day: "", date: format(addDays(new Date(), 5), "yyyy-MM-dd"), startTime: "00:00", endTime: "23:59", isBooked: false }
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
      { id: "ts4", type: "Recurring", day: "Tuesday", startTime: "13:00", endTime: "16:00", isBooked: false },
      { id: "ts5", type: "Recurring", day: "Thursday", startTime: "13:00", endTime: "16:00", isBooked: false },
      { id: "ts6", type: "Recurring", day: "Saturday", startTime: "10:00", endTime: "14:00", isBooked: false }
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
      { id: "ts7", type: "Recurring", day: "Monday", startTime: "09:00", endTime: "17:00", isBooked: true },
      { id: "ts8", type: "Recurring", day: "Tuesday", startTime: "09:00", endTime: "17:00", isBooked: true }
    ],
    lastUpdatedAvailability: format(subDays(new Date(), 10), "MMM d") 
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
  forms: FormTemplate[];
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
  const [forms] = useState<FormTemplate[]>(MOCK_FORMS);

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
      forms,
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
