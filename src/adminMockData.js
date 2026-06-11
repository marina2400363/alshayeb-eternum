export const dashboardStats = [
  { label: "Total Attendees", value: "420" },
  { label: "Incomers", value: "260" },
  { label: "Outcomers", value: "120" },
  { label: "Committee", value: "40" },
  { label: "Pending Payments", value: "27" },
  { label: "Approved Requests", value: "350" },
  { label: "Rejected Requests", value: "12" },
  { label: "Scanned Today", value: "86" }
];

export const mockEvents = [
  {
    id: "miu-prom-2026",
    name: "MIU PROM 2026",
    date: "31 MAY 2026",
    venue: "ALSHAYEB ETERNUM",
    fee: "250 EGP",
    qrRevealTime: "31 DEC 2026 - 18:00",
    registrationStatus: "Open",
    totalAttendees: 148
  },
  {
    id: "bue-prom-2026",
    name: "BUE PROM 2026",
    date: "14 JUNE 2026",
    venue: "ALSHAYEB ETERNUM",
    fee: "250 EGP",
    qrRevealTime: "31 DEC 2026 - 18:00",
    registrationStatus: "Open",
    totalAttendees: 96
  },
  {
    id: "aast-prom-2026",
    name: "AAST PROM 2026",
    date: "20 JUNE 2026",
    venue: "ALSHAYEB ETERNUM",
    fee: "250 EGP",
    qrRevealTime: "31 DEC 2026 - 18:00",
    registrationStatus: "Closed",
    totalAttendees: 112
  }
];

export const mockAttendees = [
  { id: "a1", name: "Youssef Kareem", phone: "01012345678", email: "youssef@example.com", schoolOrOriginProm: "MIU", age: 22, instagramUsername: "youssefk", event: "MIU PROM 2026", accessType: "Incomer", qrId: "ALSHAYEB-A7K2", paymentStatus: "Verified", qrStatus: "Active", status: "Approved" },
  { id: "a2", name: "Laila Hassan", phone: "01122334455", email: "laila@example.com", schoolOrOriginProm: "BUE", age: 21, instagramUsername: "lailahassan", event: "BUE PROM 2026", accessType: "Outcomer", qrId: "ALSHAYEB-J9Q4", paymentStatus: "Under Review", qrStatus: "Locked", status: "Under Review" },
  { id: "a3", name: "Omar Nabil", phone: "01299887766", email: "omar@example.com", schoolOrOriginProm: "AAST", age: 23, instagramUsername: "omarnabil", event: "AAST PROM 2026", accessType: "Committee", qrId: "ALSHAYEB-M3P8", paymentStatus: "Not Required", qrStatus: "Used", status: "Confirmed" },
  { id: "a4", name: "Mariam Adel", phone: "01566778899", email: "mariam@example.com", schoolOrOriginProm: "MIU", age: 22, instagramUsername: "mariamadel", event: "MIU PROM 2026", accessType: "Outcomer", qrId: "ALSHAYEB-R6T1", paymentStatus: "Pending", qrStatus: "Pending", status: "Pending" },
  { id: "a5", name: "Karim Tarek", phone: "01088776655", email: "karim@example.com", schoolOrOriginProm: "BUE", age: 22, instagramUsername: "karimtarek", event: "BUE PROM 2026", accessType: "Incomer", qrId: "ALSHAYEB-X2C9", paymentStatus: "Verified", qrStatus: "Active", status: "Approved" }
];

export const mockOutcomers = [
  { id: "o1", name: "Nour Samy", phone: "01022223333", email: "nour@example.com", schoolOrOriginProm: "MIU", age: 21, instagramUsername: "noursamy", event: "MIU PROM 2026", requestId: "OUT-4821", submissionDate: "2026-06-07", paymentScreenshot: "instapay-nour.png", paymentStatus: "Under Review", applicationStatus: "Pending" },
  { id: "o2", name: "Seif Ashraf", phone: "01144445555", email: "seif@example.com", schoolOrOriginProm: "BUE", age: 23, instagramUsername: "seifashraf", event: "BUE PROM 2026", requestId: "OUT-7364", submissionDate: "2026-06-07", paymentScreenshot: "instapay-seif.jpg", paymentStatus: "Verified", applicationStatus: "Approved" },
  { id: "o3", name: "Farah Emad", phone: "01255556666", email: "farah@example.com", schoolOrOriginProm: "AAST", age: 22, instagramUsername: "farahemad", event: "AAST PROM 2026", requestId: "OUT-2918", submissionDate: "2026-06-06", paymentScreenshot: "instapay-farah.jpeg", paymentStatus: "Rejected", applicationStatus: "Rejected" },
  { id: "o4", name: "Malek Hany", phone: "01577778888", email: "malek@example.com", schoolOrOriginProm: "Helwan", age: 21, instagramUsername: "malekhany", event: "MIU PROM 2026", requestId: "OUT-9152", submissionDate: "2026-06-08", paymentScreenshot: "instapay-malek.png", paymentStatus: "Under Review", applicationStatus: "Pending" }
];

export const mockPayments = [
  { id: "p1", name: "Nour Samy", phone: "01022223333", event: "MIU PROM 2026", amount: "250 EGP", status: "Under Review", submittedAt: "2026-06-07 21:14", screenshot: "instapay-nour.png" },
  { id: "p2", name: "Mariam Adel", phone: "01566778899", event: "MIU PROM 2026", amount: "250 EGP", status: "Pending", submittedAt: "2026-06-08 15:42", screenshot: "instapay-mariam.jpg" },
  { id: "p3", name: "Seif Ashraf", phone: "01144445555", event: "BUE PROM 2026", amount: "250 EGP", status: "Verified", submittedAt: "2026-06-07 19:05", screenshot: "instapay-seif.jpg" }
];

export const recentActivity = [
  "OUT-4821 submitted payment proof",
  "ALSHAYEB-A7K2 scanned at Gate A",
  "BUE PROM 2026 registration reached 96 attendees",
  "OUT-2918 rejected after payment review"
];
