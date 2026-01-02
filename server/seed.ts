import { storage } from "./storage";
import { hashPassword } from "./auth";
import { format, subDays, addDays } from "date-fns";

async function seed() {
  console.log("🌱 Seeding database...");

  try {
    // Create Admin User
    const adminPassword = await hashPassword("admin123");
    const admin = await storage.createUser({
      email: "admin@perinatalpsych.com",
      password: adminPassword,
      role: "admin",
      name: "Admin User",
    });
    console.log("✅ Created admin user");

    // Create Clinician Users
    const clinicianPassword = await hashPassword("clinician123");
    
    const emilyUser = await storage.createUser({
      email: "emily@perinatalpsych.com",
      password: clinicianPassword,
      role: "clinician",
      name: "Dr. Emily Chen",
    });

    const markUser = await storage.createUser({
      email: "mark@perinatalpsych.com",
      password: clinicianPassword,
      role: "clinician",
      name: "Mark Wilson, LMFT",
    });

    const sarahUser = await storage.createUser({
      email: "sarah@perinatalpsych.com",
      password: clinicianPassword,
      role: "clinician",
      name: "Sarah Johnson, LCSW",
    });
    console.log("✅ Created clinician users");

    // Create Clinician Profiles
    const emily = await storage.createClinician({
      userId: emilyUser.id,
      avatar: "EC",
      specialties: ["Anxiety", "Depression", "CBT"],
      capacity: 25,
      currentLoad: 22,
      maxNewClients: 2,
      bio: "Dr. Chen is a clinical psychologist with over 10 years of experience in perinatal mental health. She specializes in CBT for anxiety and depression during pregnancy and postpartum.",
      insurers: ["Aviva", "Axa", "Bupa", "Vitality"],
      location: "North London",
      nhsTrust: "Tavistock and Portman",
      worksWithCouples: false,
      tier: "Senior",
    });

    const mark = await storage.createClinician({
      userId: markUser.id,
      avatar: "MW",
      specialties: ["Couples", "Family Systems", "Trauma"],
      capacity: 20,
      currentLoad: 12,
      maxNewClients: 5,
      bio: "Mark is a licensed marriage and family therapist. He focuses on helping couples navigate the transition to parenthood and resolving relationship conflicts.",
      insurers: ["Cigna", "WPA"],
      location: "West London",
      nhsTrust: "Imperial College Healthcare",
      worksWithCouples: true,
      tier: "Associate",
    });

    const sarah = await storage.createClinician({
      userId: sarahUser.id,
      avatar: "SJ",
      specialties: ["Adolescents", "Eating Disorders"],
      capacity: 22,
      currentLoad: 20,
      maxNewClients: 1,
      bio: "Sarah is a clinical social worker specializing in adolescent mental health and eating disorders. She has a warm, empathetic approach.",
      insurers: ["Aviva", "Bupa", "WPA"],
      location: "South London",
      nhsTrust: "South London and Maudsley",
      worksWithCouples: false,
      tier: "Director",
    });
    console.log("✅ Created clinician profiles");

    // Create Time Slots
    await storage.createTimeSlot({
      clinicianId: emily.id,
      type: "Recurring",
      day: "Monday",
      startTime: "10:00",
      endTime: "15:00",
      isBooked: true,
    });

    await storage.createTimeSlot({
      clinicianId: emily.id,
      type: "Recurring",
      day: "Wednesday",
      startTime: "10:00",
      endTime: "15:00",
      isBooked: false,
    });

    await storage.createTimeSlot({
      clinicianId: emily.id,
      type: "Recurring",
      day: "Friday",
      startTime: "09:00",
      endTime: "13:00",
      isBooked: false,
    });

    await storage.createTimeSlot({
      clinicianId: emily.id,
      type: "Vacation",
      day: "",
      date: format(addDays(new Date(), 5), "yyyy-MM-dd"),
      startTime: "00:00",
      endTime: "23:59",
      isBooked: false,
    });

    await storage.createTimeSlot({
      clinicianId: mark.id,
      type: "Recurring",
      day: "Tuesday",
      startTime: "13:00",
      endTime: "16:00",
      isBooked: false,
    });

    await storage.createTimeSlot({
      clinicianId: mark.id,
      type: "Recurring",
      day: "Thursday",
      startTime: "13:00",
      endTime: "16:00",
      isBooked: false,
    });

    await storage.createTimeSlot({
      clinicianId: mark.id,
      type: "Recurring",
      day: "Saturday",
      startTime: "10:00",
      endTime: "14:00",
      isBooked: false,
    });

    await storage.createTimeSlot({
      clinicianId: sarah.id,
      type: "Recurring",
      day: "Monday",
      startTime: "09:00",
      endTime: "17:00",
      isBooked: true,
    });

    await storage.createTimeSlot({
      clinicianId: sarah.id,
      type: "Recurring",
      day: "Tuesday",
      startTime: "09:00",
      endTime: "17:00",
      isBooked: true,
    });
    console.log("✅ Created time slots");

    // Create Sample Clients
    const client1 = await storage.createClient({
      email: "client1@example.com",
      status: "New",
      presentingIssues: ["Anxiety", "Work Stress"],
      insurer: "Private",
      notes: "Requires evening slots.",
    });

    await storage.createClient({
      email: "client2@example.com",
      status: "Forms Sent",
      presentingIssues: ["Depression"],
      insurer: "Bupa",
      notes: "Waiting on insurance details.",
    });

    await storage.createClient({
      email: "client3@example.com",
      status: "Forms Completed",
      presentingIssues: ["Couples Therapy", "Communication"],
      notes: "Ready for allocation. Needs calm demeanor.",
    });

    const client4 = await storage.createClient({
      email: "client4@example.com",
      status: "New",
      presentingIssues: ["Anxiety"],
      notes: "Prefers Dr. Chen.",
    });

    // Assign one client
    const emilySlot = await storage.getTimeSlotsByClinicianId(emily.id);
    const mondaySlot = emilySlot.find(s => s.day === "Monday");
    
    if (mondaySlot) {
      await storage.assignClinicianToClient(client4.id, emily.id, mondaySlot.id);
      console.log("✅ Assigned client to clinician");
    }

    await storage.createClient({
      email: "client5@example.com",
      status: "Waitlist",
      presentingIssues: ["Specific Phobia"],
      notes: "Needs weekend availability.",
    });
    console.log("✅ Created sample clients");

    // Create Form Template
    await storage.createFormTemplate({
      title: "Therapy Enquiry Form",
      description: "Standard intake form for new clients to assess needs and risk.",
      fields: [
        {
          id: "intro",
          type: "info",
          label: "Introduction",
          content: "This form enables us to plan next steps and to ensure that we are the best fit for you."
        },
        {
          id: "dob",
          type: "date",
          label: "Date of Birth",
          required: true
        },
        {
          id: "phone",
          type: "tel",
          label: "Telephone number",
          required: true
        },
        {
          id: "reason",
          type: "textarea",
          label: "What has led you to seek support at this time?",
          required: true
        }
      ],
    });
    console.log("✅ Created form templates");

    // Create Sample Tasks
    await storage.createTask({
      title: `Process Intake for ${client1.displayId}`,
      description: "Review initial inquiry and send standard intake forms packet.",
      assignee: "Sarah",
      dueDate: new Date(),
      priority: "High",
      status: "Pending",
      relatedClientId: client1.id,
    });

    await storage.createTask({
      title: "Insurance Verification",
      description: "Verify coverage with Bupa for new depression treatment plan.",
      assignee: "Rosie",
      dueDate: addDays(new Date(), 1),
      priority: "Medium",
      status: "Pending",
    });

    await storage.createTask({
      title: "Availability Reminder",
      description: "Remind Sarah Johnson to update her calendar for next month.",
      assignee: "Suzanne",
      dueDate: new Date(),
      priority: "Low",
      status: "Pending",
    });
    console.log("✅ Created sample tasks");

    console.log("\n🎉 Database seeded successfully!");
    console.log("\n📝 Login credentials:");
    console.log("Admin: admin@perinatalpsych.com / admin123");
    console.log("Clinician (Emily): emily@perinatalpsych.com / clinician123");
    console.log("Clinician (Mark): mark@perinatalpsych.com / clinician123");
    console.log("Clinician (Sarah): sarah@perinatalpsych.com / clinician123\n");
    
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    throw error;
  }
}

export { seed };

// Run seed
seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
