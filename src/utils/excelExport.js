import * as XLSX from "xlsx";

export const EXPORT_COLUMNS = [
  "Full Name",
  "Phone Number",
  "Email",
  "Gender",
  "School / Origin Prom",
  "Age",
  "Instagram Username",
  "Status",
  "Prom",
  "Amount",
  "Entry Time"
];

export function normalizeStatusLabel(status, fallback = "Pending") {
  const normalized = String(status || fallback).replace(/_/g, " ").trim();
  if (!normalized) return fallback;
  return normalized
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function attendeeName(attendee) {
  return attendee?.fullName || attendee?.name || attendee?.Name || "Unknown";
}

export function attendeePhone(attendee) {
  return attendee?.phoneNumber || attendee?.phone || attendee?.Phone || "";
}

export function attendeeProm(attendee) {
  return attendee?.eventName || attendee?.event || attendee?.Prom || attendee?.Venue || "ALSHAYEB ETERNUM";
}

export function toAdminAttendee(attendee) {
  const entryUsed = !!(attendee.isUsed);
  return {
    id: attendee.id || attendee._id,
    requestId: attendee.requestId || attendee.qrId || attendee.id,
    name: attendeeName(attendee),
    phone: attendeePhone(attendee),
    email: attendee.email || "",
    gender: attendee.gender || "",
    schoolOrOriginProm: attendee.schoolOrOriginProm || attendee.university || "",
    age: attendee.age || "",
    instagramUsername: attendee.instagramUsername || attendee.instagram || "",
    status: normalizeStatusLabel(attendee.status),
    rawStatus: attendee.status,
    applicationStatus: normalizeStatusLabel(attendee.applicationStatus || attendee.status),
    paymentStatus: normalizeStatusLabel(attendee.paymentStatus),
    rawPaymentStatus: attendee.paymentStatus,
    accessType: normalizeStatusLabel(attendee.accessType || attendee.attendeeType || "Guest"),
    attendeeType: attendee.attendeeType || "",
    // qrStatus uses isUsed (venue entry) — status never becomes "used" in the lifecycle
    qrStatus: entryUsed ? "Used" : attendee.qrToken || attendee.qrId ? "Active" : "Pending",
    qrToken: attendee.qrToken,
    qrId: attendee.qrId,
    event: attendeeProm(attendee),
    amount: attendee.event?.price ? `${attendee.event.price} EGP` : (attendee.amount || "TBA"),
    submittedAt: attendee.createdAt ? new Date(attendee.createdAt).toLocaleString() : "",
    paymentProof: attendee.paymentProof,
    outcomerPhoto: attendee.outcomerPhoto,
    // Venue entry fields — separate from lifecycle status
    isUsed: entryUsed,
    scannedAt: attendee.scannedAt ? new Date(attendee.scannedAt).toLocaleString() : null,
    scanCount: attendee.scanCount || 0
  };
}

export function sanitizeExcelSheetName(name, usedNames = new Set()) {
  const fallback = "Prom";
  const invalidSheetChars = new Set(["[", "]", ":", "*", "?", "/", "\\"]);
  const base = String(name || fallback)
    .split("")
    .map((character) => (invalidSheetChars.has(character) ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31) || fallback;

  let sheetName = base;
  let counter = 2;

  while (usedNames.has(sheetName.toLowerCase())) {
    const suffix = ` ${counter}`;
    sheetName = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    counter += 1;
  }

  usedNames.add(sheetName.toLowerCase());
  return sheetName;
}

export function buildRegistrationExportRows(attendees = []) {
  return attendees.map((attendee) => {
    const row = toAdminAttendee(attendee);

    return {
      promName: row.event,
      "Full Name": row.name,
      "Phone Number": row.phone,
      Email: row.email || "",
      Gender: row.gender || "",
      "School / Origin Prom": row.schoolOrOriginProm || "",
      Age: row.age || "",
      "Instagram Username": row.instagramUsername || "",
      Status: row.status || row.paymentStatus || "",
      Prom: row.event,
      Amount: row.amount || "",
      "Entry Time": attendee.event?.entryTime || "TBA"
    };
  });
}

export function exportRegistrationsByProm(attendees = []) {
  const rows = buildRegistrationExportRows(attendees);
  const groupedRows = rows.reduce((groups, row) => {
    const promName = row.promName || row.Prom || "Unknown Prom";
    if (!groups.has(promName)) {
      groups.set(promName, []);
    }
    groups.get(promName).push(row);
    return groups;
  }, new Map());

  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set();

  groupedRows.forEach((promRows, promName) => {
    if (!promRows.length) return;

    const orderedRows = promRows.map((row) =>
      EXPORT_COLUMNS.reduce((ordered, column) => {
        ordered[column] = row[column] ?? "";
        return ordered;
      }, {})
    );
    const worksheet = XLSX.utils.json_to_sheet(orderedRows, { header: EXPORT_COLUMNS });
    worksheet["!cols"] = EXPORT_COLUMNS.map((column) => ({
      wch: Math.max(column.length + 2, 16)
    }));

    XLSX.utils.book_append_sheet(workbook, worksheet, sanitizeExcelSheetName(promName, usedSheetNames));
  });

  if (!workbook.SheetNames.length) {
    const worksheet = XLSX.utils.aoa_to_sheet([["No registrations found"]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "No Registrations");
  }

  XLSX.writeFile(workbook, "alshayeb-registrations-by-prom.xlsx");
}
