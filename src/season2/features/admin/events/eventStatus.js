// Admin-side presentation of the three event statuses. AVAILABLE is only a
// stored, event-level status: it does not make anything public.
export const STATUS_LABELS = {
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
  COMING_SOON: "Coming soon"
};

// Maps onto the existing StatusBadge vocabulary.
export const STATUS_BADGE = {
  AVAILABLE: "success",
  UNAVAILABLE: "declined",
  COMING_SOON: "pending"
};

// Events render greyed out in the list unless AVAILABLE. They stay fully
// editable in Admin regardless of status.
export const isMuted = (status) => status !== "AVAILABLE";
