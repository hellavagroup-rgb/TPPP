import { db } from "./db";
import { users, clinicians, formTemplates, clients, tasks, formSubmissions, timeSlots, auditLogs } from "../shared/schema";
import { eq } from "drizzle-orm";

const seedData = {
  users: [
    { id: "97412512-047a-47d7-a202-8c8aa1d2f815", email: "admin@perinatalpsych.com", password: "71645d48cf84955b491e95f33c9ddf24886186d81995752d25d6c9971255f34b448444fb8d080328709e5ad3bdd3045062a613d463856074fe4b7d4f281056dd.3a224bc00de3889bed4277e4385502ac", role: "admin" as const, name: "Admin User" },
    { id: "c26bb220-9595-47d1-bd77-5cbe78fb9860", email: "abi@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Abi" },
    { id: "4a49486e-f84e-487d-bccd-4f0933278930", email: "amara@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Amara" },
    { id: "6a59e95d-e017-4c3d-8dc8-8ccbbd3cef87", email: "anna@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Anna" },
    { id: "edd921f6-5b5e-479d-8dc8-579af83c08e2", email: "caroline@perinatalpsych.com", password: "c36f5318f75ebf5bddf45bbe7ce96a9da40649aa8c57096ff0c785b947d564ea14c7f96408f5e0ecde3740f89fc9f8a9145562e8fb5fb0b0a51f8504dea6f036.e3380cbe0943955b6219f06f4bf4e563", role: "clinician" as const, name: "Caroline" },
    { id: "f45b0679-1b5c-48b6-8371-27bbcce12ae0", email: "christy@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Christy" },
    { id: "b3fd8254-e7a7-4477-8302-a972a866a100", email: "danelle@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Danelle" },
    { id: "d24c6be8-4f67-4d0d-bc74-32b60ffeff39", email: "ukwuori@perinatalpsych.com", password: "c36f5318f75ebf5bddf45bbe7ce96a9da40649aa8c57096ff0c785b947d564ea14c7f96408f5e0ecde3740f89fc9f8a9145562e8fb5fb0b0a51f8504dea6f036.e3380cbe0943955b6219f06f4bf4e563", role: "clinician" as const, name: "Dr. Ukwuori" },
    { id: "748175e6-d260-4308-8597-ed55aae7ef32", email: "faye@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Faye" },
    { id: "ac76664a-6153-4c9d-9e0d-abca4f0afa40", email: "helen@perinatalpsych.com", password: "c36f5318f75ebf5bddf45bbe7ce96a9da40649aa8c57096ff0c785b947d564ea14c7f96408f5e0ecde3740f89fc9f8a9145562e8fb5fb0b0a51f8504dea6f036.e3380cbe0943955b6219f06f4bf4e563", role: "clinician" as const, name: "Helen" },
    { id: "e5946ae0-41a8-4176-b5cc-7c63e55fb889", email: "kate@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Kate" },
    { id: "6d6d4bc4-e1f6-4596-b471-46635c66ec29", email: "laura@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Laura" },
    { id: "0ea08ccb-e2bc-48de-a262-65b62132cffd", email: "lauren@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Lauren" },
    { id: "ddb048f3-98d4-454a-b8b8-f56cc24665ff", email: "louisa@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Louisa" },
    { id: "e712b8ca-5179-4ce1-ba7f-3983655f20e3", email: "megan@perinatalpsych.com", password: "c36f5318f75ebf5bddf45bbe7ce96a9da40649aa8c57096ff0c785b947d564ea14c7f96408f5e0ecde3740f89fc9f8a9145562e8fb5fb0b0a51f8504dea6f036.e3380cbe0943955b6219f06f4bf4e563", role: "clinician" as const, name: "Megan" },
    { id: "95fa4b04-d2ac-4f98-a717-ae71b1f9d92a", email: "natalie@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Natalie" },
    { id: "4076c3e5-5bc0-4fd3-a6fd-7fd15c28ded5", email: "paula@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Paula" },
    { id: "a16c30fd-197b-4f5f-86db-30de9c35aa5e", email: "rosie@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Rosie" },
    { id: "e655b6e2-0e75-4ec8-931e-2624d48fe01d", email: "saraha@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Sarah A" },
    { id: "de3d0744-9afc-435b-af8e-96dd11848443", email: "sarahj@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Sarah J" },
    { id: "4eb929ed-fc8a-46eb-8012-7c1f786f4405", email: "sinead@perinatalpsych.com", password: "8bc4e92520fde54e409f63f50ba09b3e49fea1a1cbd96ebf85824f18869b3d05273362ed339570a7ed5db41d701879dc3f0f6007b9635ce6a821d905d9ccc3c2.5f61d83615ee1052ce80da165e8d7a41", role: "clinician" as const, name: "Sinead" },
  ],
  clinicians: [
    { id: "a3e44310-bbdd-4a0f-9d00-b8415f8c1006", userId: "d24c6be8-4f67-4d0d-bc74-32b60ffeff39", avatar: "UK", specialties: ["Couples", "Perinatal Loss", "Perinatal OCD", "CBT", "EMDR", "BCT", "NET", "CFT"], capacity: 15, currentLoad: 0, maxNewClients: 0, bio: "EMDR and BCT cases preferably. Specialist interest in couples, perinatal loss, perinatal OCD. Approaches: CBT, EMDR, BCT, NET, CFT.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "South London", nhsTrust: "Oxleas MMHS", worksWithCouples: true, tier: "Senior", contactMethods: ["Email", "Text"] },
    { id: "a23bccaa-6f58-4a4c-9b47-4af4ba7712ee", userId: "ac76664a-6153-4c9d-9e0d-abca4f0afa40", avatar: "HE", specialties: ["CBT", "ACT", "CFT", "Mindfulness", "Perfectionism", "Work-Life Balance"], capacity: 18, currentLoad: 0, maxNewClients: 3, bio: "Supporting people to address high standards, perfectionism and self-criticism. Support with work-related issues surrounding maternity leave or difficulties managing a return to work. Availability: 10.30-2.30 Mondays, 11-5 Wednesdays and 11am-3pm Fridays.", insurers: ["Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "Brighton", nhsTrust: null, worksWithCouples: false, tier: "Associate", contactMethods: ["Email"] },
    { id: "5d3ffbd8-1a86-4045-8d14-b58247cd7144", userId: "e712b8ca-5179-4ce1-ba7f-3983655f20e3", avatar: "ME", specialties: ["EMDR", "CBT", "Mindfulness", "ACT", "CFT", "Attachment", "Parent-Child Relationship"], capacity: 20, currentLoad: 0, maxNewClients: 4, bio: "EMDR trained. Experience in working with a variety of complex mental health problems. Passion for working with attachment parent/child relationship. Supporting individuals in the perinatal period with depression, anxiety, perinatal OCD, perinatal loss and couples adjustment.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "Dorset/Hampshire border", nhsTrust: null, worksWithCouples: true, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "bd5a5026-57e0-4c77-99ed-b51c2ddbabe5", userId: "edd921f6-5b5e-479d-8dc8-579af83c08e2", avatar: "CA", specialties: ["CBT", "EMDR", "CFT", "Mindfulness", "Eating Disorders", "Trauma", "Body Image"], capacity: 16, currentLoad: 0, maxNewClients: 2, bio: "Approaches: CBT, EMDR, CFT, and other third wave approaches including mindfulness. Present focused approach or exploring long-standing unhelpful beliefs. Experience in eating disorders, trauma, and long-term physical health conditions. Special interest in body image difficulties, anxiety, self-criticism, perfectionism, and trauma.", insurers: ["Bupa", "Cigna", "Vitality"], location: null, nhsTrust: null, worksWithCouples: false, tier: "Senior", contactMethods: [] },
    { id: "0911f785-dbc5-439a-b35c-4c6d02b37a64", userId: "f45b0679-1b5c-48b6-8371-27bbcce12ae0", avatar: "CH", specialties: ["Trauma", "CBT", "EMDR", "Parenting Support"], capacity: 18, currentLoad: 12, maxNewClients: 3, bio: "Wide range of mental health difficulties including early childhood trauma or trauma in perinatal period. Therapeutic relationship focus. CBT, EMDR, parenting young children.", insurers: ["Axa", "Bupa", "Cigna", "Vitality"], location: "South West London", nhsTrust: "CNWL", worksWithCouples: false, tier: "Associate", contactMethods: [] },
    { id: "c7db99bd-331c-457f-85a6-2aadc3397326", userId: "ddb048f3-98d4-454a-b8b8-f56cc24665ff", avatar: "LO", specialties: ["Anxiety", "Depression", "Birth Trauma", "PTSD", "Perinatal OCD", "Perinatal Loss", "CBT", "CFT", "ACT", "EMDR"], capacity: 16, currentLoad: 14, maxNewClients: 1, bio: "Perinatal mental health: anxiety, depression, birth trauma, PTSD, perinatal OCD, perinatal loss. CBT, CFT, ACT, EMDR, parent-infant interventions.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "East London", nhsTrust: "NELFT", worksWithCouples: false, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "41ae7337-0ac6-4aff-b6fb-75016e2a4931", userId: "748175e6-d260-4308-8597-ed55aae7ef32", avatar: "FA", specialties: ["ACT", "CBT", "CFT", "EMDR", "Anxiety", "Depression", "Birth Trauma", "OCD", "Tokophobia"], capacity: 17, currentLoad: 13, maxNewClients: 2, bio: "ACT, CBT, CFT, EMDR. Anxiety, depression, birth trauma, OCD, low self-esteem, perfectionism, tokophobia.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "Derbyshire", nhsTrust: "Derbyshire", worksWithCouples: false, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "3a729eca-bda0-4862-b25a-92eda08600c1", userId: "e5946ae0-41a8-4176-b5cc-7c63e55fb889", avatar: "KA", specialties: ["Trauma", "Tokophobia", "Birth Trauma", "Pregnancy Loss", "Couples", "Depression", "Anxiety", "CBT", "EMDR", "CFT"], capacity: 17, currentLoad: 13, maxNewClients: 2, bio: "Trauma, tokophobia, birth trauma, pregnancy loss, couples, depression, anxiety. CBT, EMDR, CFT.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "North London", nhsTrust: "Whittington", worksWithCouples: true, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "38fd35f7-1a38-4033-a7a3-28e74a7b5919", userId: "de3d0744-9afc-435b-af8e-96dd11848443", avatar: "SA", specialties: ["Birth Trauma", "Tokophobia", "Perinatal Anxiety", "OCD", "Depression", "CBT", "EMDR", "CFT", "ACT"], capacity: 15, currentLoad: 15, maxNewClients: 0, bio: "Birth trauma, tokophobia, perinatal anxiety, OCD, depression. CBT, EMDR, CFT, ACT.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "North London", nhsTrust: "Barnet Enfield Haringey", worksWithCouples: false, tier: "Associate", contactMethods: ["Email"] },
    { id: "d27bfd5f-917b-492d-8b10-7fbd551ec417", userId: "c26bb220-9595-47d1-bd77-5cbe78fb9860", avatar: "AB", specialties: ["Anxiety", "Depression", "PTSD", "Birth Trauma", "Perinatal Loss", "OCD", "CBT", "EMDR", "CFT", "ACT"], capacity: 16, currentLoad: 14, maxNewClients: 1, bio: "Anxiety, depression, PTSD, birth trauma, perinatal loss, OCD. CBT, EMDR, CFT, ACT.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "West Midlands", nhsTrust: "Birmingham and Solihull", worksWithCouples: false, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "3cf26d32-5a7f-42fd-bbe9-73fa6eec0371", userId: "4eb929ed-fc8a-46eb-8012-7c1f786f4405", avatar: "SI", specialties: ["Perinatal Mental Health", "Anxiety", "Depression", "Birth Trauma", "Couples", "CBT", "CFT", "EMDR"], capacity: 15, currentLoad: 15, maxNewClients: 0, bio: "Perinatal mental health, anxiety, depression, birth trauma, couples. CBT, CFT, EMDR.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "London", nhsTrust: null, worksWithCouples: true, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "1bbc834e-b620-4d04-bdff-fe7b0cd86ea3", userId: "6a59e95d-e017-4c3d-8dc8-8ccbbd3cef87", avatar: "AN", specialties: ["Perinatal Anxiety", "Depression", "OCD", "Trauma", "CBT", "EMDR", "CFT"], capacity: 17, currentLoad: 13, maxNewClients: 2, bio: "Perinatal anxiety, depression, OCD, trauma. CBT, EMDR, CFT.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "Central London", nhsTrust: null, worksWithCouples: false, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "396f953d-7934-4748-9b09-70130293b5a5", userId: "4a49486e-f84e-487d-bccd-4f0933278930", avatar: "AM", specialties: ["Perinatal Mental Health", "Anxiety", "Depression", "Trauma", "OCD", "CBT", "EMDR", "CFT", "ACT"], capacity: 18, currentLoad: 12, maxNewClients: 3, bio: "Perinatal mental health specialist. Anxiety, depression, trauma, OCD. CBT, EMDR, CFT, ACT.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "South London", nhsTrust: null, worksWithCouples: false, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "6b8a2890-f4e0-4972-8d8b-88ae3cddfc48", userId: "a16c30fd-197b-4f5f-86db-30de9c35aa5e", avatar: "RO", specialties: ["Birth Trauma", "Tokophobia", "Perinatal Loss", "Anxiety", "Depression", "CBT", "EMDR", "CFT"], capacity: 16, currentLoad: 14, maxNewClients: 1, bio: "Birth trauma, tokophobia, perinatal loss, anxiety, depression. CBT, EMDR, CFT.", insurers: ["Aviva", "Axa", "Bupa", "Cigna", "Vitality", "WPA"], location: "South London", nhsTrust: null, worksWithCouples: false, tier: "Associate", contactMethods: ["Email"] },
    { id: "6be48cab-e85d-4faa-abca-b3817f06fc5f", userId: "0ea08ccb-e2bc-48de-a262-65b62132cffd", avatar: "LA", specialties: ["Birth Trauma", "Neonatal", "Antenatal Anxiety", "Depression", "Tokophobia", "Grief", "Loss", "Bonding", "EMDR", "CBT", "CFT"], capacity: 16, currentLoad: 14, maxNewClients: 1, bio: "Birth trauma, neonatal care, antenatal anxiety/depression, tokophobia, grief & loss, bonding difficulties. EMDR, tf-CBT, CBT, compassion focused.", insurers: ["Aviva", "Axa", "Bupa", "Vitality", "WPA"], location: "Edinburgh", nhsTrust: "Edinburgh and Lothian", worksWithCouples: false, tier: "Associate", contactMethods: [] },
    { id: "f3b0800d-8782-4817-88cd-af3c5fd270c2", userId: "4076c3e5-5bc0-4fd3-a6fd-7fd15c28ded5", avatar: "PA", specialties: ["Perinatal", "Couples", "Family Therapy", "Systemic"], capacity: 17, currentLoad: 13, maxNewClients: 2, bio: "Perinatal difficulties. Couples work. Family Interventions, BFT, systemic family therapy.", insurers: ["Aviva", "Bupa", "Cigna", "Vitality", "WPA"], location: "SE London", nhsTrust: "Barts Health Trust", worksWithCouples: true, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "a32ea839-1ed6-4a23-8f6d-716335791d7e", userId: "95fa4b04-d2ac-4f98-a717-ae71b1f9d92a", avatar: "NA", specialties: ["CBT", "CFT", "ACT", "Fertility", "Birth Trauma", "Anxiety", "OCD", "Health Anxiety", "Pregnancy After Loss"], capacity: 15, currentLoad: 15, maxNewClients: 0, bio: "CBT, CFT, ACT. Perinatal, fertility, birth trauma, anxiety, chronic pain, OCD, health anxiety, pregnancy after loss. CFT for psychosexual difficulties.", insurers: ["Aviva", "Axa", "Bupa", "Vitality", "WPA"], location: "North London", nhsTrust: "Camden and Islington", worksWithCouples: false, tier: "Associate", contactMethods: ["Email"] },
    { id: "9c051821-260c-4869-b208-7fa70820fa46", userId: "6d6d4bc4-e1f6-4596-b471-46635c66ec29", avatar: "LA", specialties: ["EMDR", "Attachment", "Developmental Trauma", "PTSD", "Anxiety", "Parent-Baby Attachment", "ACT", "CBT"], capacity: 16, currentLoad: 14, maxNewClients: 1, bio: "EMDR, VIG, NBO, DDP trained. Attachment/developmental trauma. PTSD, anxiety, parent/baby attachment. ACT/CBT/narrative.", insurers: ["Axa", "Bupa", "Vitality", "WPA"], location: "South Wales", nhsTrust: null, worksWithCouples: false, tier: "Associate", contactMethods: ["Email", "WhatsApp"] },
    { id: "b8e5e080-7da4-403c-9bfe-39f97af5fd6d", userId: "e655b6e2-0e75-4ec8-931e-2624d48fe01d", avatar: "SA", specialties: ["Tokophobia", "Birth Trauma", "Trauma", "Bereavement", "Neonatal", "Paediatric Intensive Care"], capacity: 15, currentLoad: 15, maxNewClients: 0, bio: "Fear of childbirth, birth trauma, trauma, bereavement. Specialist in neonatal and paediatric intensive care. NO OCD cases.", insurers: ["Bupa"], location: "Cambridge", nhsTrust: "CPFT", worksWithCouples: true, tier: "Associate", contactMethods: ["Email", "Text"] },
    { id: "2b5915af-6d82-499e-82b0-e43c276fbd4c", userId: "b3fd8254-e7a7-4477-8302-a972a866a100", avatar: "DA", specialties: ["OCD", "Birth Trauma", "Depression", "Anxiety", "Self-Esteem", "ACT", "CBT", "CFT", "EMDR", "MBT", "MBCT"], capacity: 25, currentLoad: 5, maxNewClients: 10, bio: "OCD, birth trauma, depression, anxiety, self-esteem, maternal role adaptation, return to work. Recovery following hospital admission. Pregnancy/parenting after loss/fertility issues. ACT, CBT, CFT, EMDR, MBT, Reflective Parenting, MBCT, Narrative.", insurers: [], location: null, nhsTrust: null, worksWithCouples: false, tier: "Associate", contactMethods: [] },
  ],
  formTemplates: [
    {
      id: "6831039b-441b-438e-9c39-1c3f869d3416",
      title: "Therapy Enquiry Form",
      description: "Standard intake form for new clients to assess needs and risk.",
      fields: [
        { id: "intro", type: "info", label: "Therapy Enquiry Form", content: "This form enables us to plan next steps and to ensure that we are the best fit for you. We know that finding therapeutic help is anxiety provoking and we want to make sure that you are able to move forward with confidence.\n\nThis short questionnaire usually takes around 10–15 minutes to complete and helps us understand what's been going on for you, what kind of support you're looking for, and how to match you with the most appropriate clinician within our practice.\n\nThe information you share will be reviewed by a senior clinician and used to:\n• Understand your main difficulties and current needs\n• Check whether there are any urgent risk or safety concerns\n• Consider any preferences or adjustments that would help you feel comfortable in therapy\n• Allocate you to a clinician whose experience and availability best fits your needs\n\nThis helps us ensure you receive the right support, as quickly and safely as possible.\n\nEverything you share in this form is treated as confidential and stored securely in line with professional and data protection standards. Your information will only be accessed by relevant members of our clinical team.\n\nPlease note all sessions are online.\n\nYour personal data will be protected under GDPR legislation." },
        { id: "section1_header", type: "info", label: "Section 1: About You", content: "" },
        { id: "fullName", type: "text", label: "Full Name", required: true },
        { id: "dob", type: "date", label: "Date of Birth", required: true },
        { id: "pronouns", type: "text", label: "What are your preferred pronouns?", required: false },
        { id: "phone", type: "tel", label: "Telephone number", required: true },
        { id: "voicemailOk", type: "radio", label: "Is it OK to leave a voicemail?", required: true, options: ["Yes", "No"] },
        { id: "email", type: "email", label: "Email address", required: true },
        { id: "perinatalStatus", type: "checkbox", label: "Are you currently pregnant, postpartum, or parenting young children?", required: false, options: ["Pregnant", "Postpartum", "Trying to conceive / fertility journey", "Parenting young children"] },
        { id: "dueDate", type: "date", label: "If pregnant, when is your estimated due date?", required: false, showWhen: { field: "perinatalStatus", contains: "Pregnant" } },
        { id: "babyAge", type: "text", label: "If postnatal, how old is your baby or children?", required: false, showWhen: { field: "perinatalStatus", contains: "Postpartum" } },
        { id: "section2_header", type: "info", label: "Section 2: Main Concerns", content: "" },
        { id: "reasonForSupport", type: "textarea", label: "What has led you to seek support at this time?", required: true },
        { id: "difficulties", type: "checkbox", label: "Which difficulties are affecting you? (Tick all that apply)", required: false, options: ["Anxiety or excessive worry", "Low mood / depression", "Birth trauma / previous trauma", "Intrusive or distressing thoughts", "Panic attacks", "Sleep difficulties", "Bonding/attachment concerns", "Grief and distress following loss", "Other"] },
        { id: "difficultiesOther", type: "text", label: "If other, please specify:", required: false, showWhen: { field: "difficulties", contains: "Other" } },
        { id: "difficultyDuration", type: "radio", label: "How long have these difficulties been affecting you?", required: true, options: ["<2 weeks", "2-6 weeks", "6 weeks-6 months", ">6 months"] },
        { id: "additionalDetails", type: "textarea", label: "If helpful, please let us know any detail in relation to your responses above.", required: false },
        { id: "safety_header", type: "info", label: "Safety and Risk Assessment", content: "The following questions ask about safety and risk. We ask these questions of everyone, as part of our responsibility to help keep you and your family safe and to make sure you receive the right level of support.\n\nSome people worry that answering these questions honestly might affect their access to therapy. Please be reassured that having difficult or intrusive thoughts does not mean you will be judged or excluded from support. Many people experience thoughts they find upsetting, especially during pregnancy or after birth.\n\nYour answers help us understand what support is needed and whether there are any immediate concerns we should respond to more quickly. If any of these questions feel difficult, you can take your time or skip any you are not ready to answer." },
        { id: "selfHarmThoughts", type: "radio", label: "Thoughts of Harming Yourself", required: true, options: ["No", "Yes, Sometimes", "Yes, Frequently"] },
        { id: "selfHarmPlans", type: "radio", label: "Any Current Plans or Intention?", required: true, options: ["No", "Unsure", "Yes"] },
        { id: "recentSelfHarm", type: "radio", label: "Recent Self-Harm", required: true, options: ["No", "Yes"] },
        { id: "safetyNotes", type: "textarea", label: "Is there anything else you think we should know about in relation to your safety?", required: false },
        { id: "section4_header", type: "info", label: "Section 3: Therapy History", content: "" },
        { id: "previousTherapy", type: "radio", label: "Have you previously had therapy?", required: true, options: ["No", "Yes"] },
        { id: "previousTherapyDetails", type: "textarea", label: "Please tell us briefly about the therapy you have had previously (e.g. When was it? How long were you in therapy for? Do you know what type of therapy it was? What did you find helpful or not so helpful about it?)", required: false, showWhen: { field: "previousTherapy", equals: "Yes" } },
        { id: "mentalHealthDiagnosis", type: "radio", label: "Have you ever been diagnosed with a mental health difficulty?", required: true, options: ["No", "Yes"] },
        { id: "diagnosisDetails", type: "textarea", label: "Can you provide us with some detail around this:", required: false, showWhen: { field: "mentalHealthDiagnosis", equals: "Yes" } },
        { id: "currentMedication", type: "radio", label: "Are you currently prescribed any medication to support your mental health?", required: true, options: ["No", "Yes"] },
        { id: "medicationDetails", type: "textarea", label: "Can you provide us with some detail around this?", required: false, showWhen: { field: "currentMedication", equals: "Yes" } },
        { id: "nhsCare", type: "radio", label: "Are you currently under the care of a perinatal mental health team or other NHS mental health team?", required: true, options: ["Yes", "No"] },
        { id: "nhsCareDetails", type: "textarea", label: "Please provide us with some detail on this:", required: false, showWhen: { field: "nhsCare", equals: "Yes" } },
        { id: "section5_header", type: "info", label: "Section 4: Practical Details", content: "" },
        { id: "availability", type: "textarea", label: "What days and times would you be available for therapy? Please note the more flexible your availability the quicker we are likely to be able to allocate a therapist.", required: true },
        { id: "neurodiversity", type: "radio", label: "Would you like us to be aware of any neurodiversity-related needs or adjustments that could help you feel more comfortable in therapy? (For example: ADHD, autism, sensory sensitivities, communication preferences, pacing/structure needs.)", required: true, options: ["Yes", "No"] },
        { id: "neurodiversityDetails", type: "textarea", label: "If yes, please let us know what you would find helpful:", required: false, showWhen: { field: "neurodiversity", equals: "Yes" } },
        { id: "otherInfo", type: "textarea", label: "Is there anything else that would be helpful for us to know about?", required: false },
        { id: "section6_header", type: "info", label: "Section 5: Consent", content: "" },
        { id: "consent", type: "radio", label: "Do you consent to us using this information to match you with a clinician?", required: true, options: ["Yes", "No"] }
      ]
    }
  ]
};

export async function seedDatabaseIfEmpty() {
  try {
    console.log("=== SEED CHECK STARTING ===");
    
    // Check if we have all 20 clinicians with correct IDs
    const existingClinicians = await db.select().from(clinicians);
    const existingClients = await db.select().from(clients);
    const existingForms = await db.select().from(formTemplates);
    
    console.log(`Found ${existingClinicians.length} clinicians, ${existingClients.length} clients, ${existingForms.length} forms`);
    
    const expectedClinicianIds = new Set(seedData.clinicians.map(c => c.id));
    const hasAllClinicians = existingClinicians.length >= 20 && 
      existingClinicians.every(c => expectedClinicianIds.has(c.id));
    
    // Check if form templates need updating (compare field counts)
    const expectedFormId = seedData.formTemplates[0]?.id;
    const existingForm = existingForms.find(f => f.id === expectedFormId);
    const expectedFieldCount = (seedData.formTemplates[0]?.fields as any[])?.length || 0;
    const existingFieldCount = existingForm ? (existingForm.fields as any[])?.length || 0 : 0;
    const formNeedsUpdate = existingForm && existingFieldCount < expectedFieldCount;
    
    // If there are old clients (test data) OR missing clinicians/forms, we need to reseed
    const needsReseed = existingClients.length > 0 || !hasAllClinicians || existingForms.length === 0;
    
    // Always update form templates if they're outdated
    if (formNeedsUpdate) {
      console.log(`Form template needs update: ${existingFieldCount} fields -> ${expectedFieldCount} fields`);
      for (const form of seedData.formTemplates) {
        await db.update(formTemplates)
          .set({ fields: form.fields, title: form.title, description: form.description, updatedAt: new Date() })
          .where(eq(formTemplates.id, form.id));
        console.log(`Updated form template: ${form.title}`);
      }
    }
    
    if (!needsReseed) {
      console.log("Database already properly seeded, skipping...");
      return;
    }
    
    console.log(`Needs reseed: clients=${existingClients.length}, hasAllClinicians=${hasAllClinicians}, forms=${existingForms.length}`);

    console.log("Seeding database with initial data...");

    // Clear any stale test/analytics data first
    console.log("Clearing stale data...");
    await db.delete(formSubmissions);
    await db.delete(timeSlots);
    await db.delete(tasks);
    await db.delete(auditLogs);
    await db.delete(clients);
    console.log("Stale data cleared");

    // Insert core data using upserts
    for (const user of seedData.users) {
      await db.insert(users).values(user).onConflictDoNothing();
    }
    console.log(`Inserted ${seedData.users.length} users`);

    for (const clinician of seedData.clinicians) {
      await db.insert(clinicians).values(clinician as any).onConflictDoNothing();
    }
    console.log(`Inserted ${seedData.clinicians.length} clinicians`);

    // Always update form templates to latest version (in case structure changed)
    for (const form of seedData.formTemplates) {
      const existingForm = existingForms.find(f => f.id === form.id);
      if (existingForm) {
        // Update to latest version
        await db.update(formTemplates)
          .set({ fields: form.fields, title: form.title, description: form.description, updatedAt: new Date() })
          .where(eq(formTemplates.id, form.id));
        console.log(`Updated form template: ${form.title}`);
      } else {
        await db.insert(formTemplates).values(form).onConflictDoNothing();
        console.log(`Inserted form template: ${form.title}`);
      }
    }

    console.log("Database seeding completed!");
  } catch (error) {
    console.error("Error seeding database:", error);
  }
}

export async function forceReseedDatabase() {
  console.log("=== FORCE RESEED STARTING ===");
  
  // Clear ALL existing data
  console.log("Clearing all existing data...");
  await db.delete(formSubmissions);
  await db.delete(timeSlots);
  await db.delete(tasks);
  await db.delete(auditLogs);
  await db.delete(clients);
  await db.delete(clinicians);
  await db.delete(formTemplates);
  // Don't delete users - keep the admin account
  console.log("All data cleared (except users)");

  // Insert fresh seed data
  for (const user of seedData.users) {
    await db.insert(users).values(user).onConflictDoNothing();
  }
  console.log(`Inserted ${seedData.users.length} users`);

  for (const clinician of seedData.clinicians) {
    await db.insert(clinicians).values(clinician as any).onConflictDoNothing();
  }
  console.log(`Inserted ${seedData.clinicians.length} clinicians`);

  for (const form of seedData.formTemplates) {
    await db.insert(formTemplates).values(form).onConflictDoNothing();
  }
  console.log(`Inserted ${seedData.formTemplates.length} form templates`);

  console.log("=== FORCE RESEED COMPLETED ===");
}
