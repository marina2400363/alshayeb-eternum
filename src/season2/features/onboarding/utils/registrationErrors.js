// Turns a failed registration request into something the UI can place.
//
// The backend answers validation problems with only a message string (no
// field key), so 4xx messages are mapped to a field by wording. Anything that
// can't be placed becomes a form-level error.
//
// Result: { field, message, title, retryable }
//   field: "school" | "fullName" | "phone" | "email" | "photo" | "form"

export function mapRegistrationError(error) {
  const message = error?.message || "Something went wrong. Please try again in a moment.";

  if (error?.kind === "network" || error?.kind === "timeout") {
    return { field: "form", title: "Connection problem", message, retryable: true };
  }

  if (error?.status >= 500) {
    return { field: "form", title: "Something went wrong", message, retryable: true };
  }

  // 4xx — wording decides the field. Email is checked first: an email message
  // (or its example, "name@example.com") must never be read as the name field.
  // Photo comes next because photo messages mention "photos"/"PNG" and must
  // never be read as another field.
  if (/e-?mail/i.test(message)) return { field: "email", title: "", message, retryable: false };
  if (/photo/i.test(message)) return { field: "photo", title: "", message, retryable: false };
  if (/school/i.test(message)) return { field: "school", title: "", message, retryable: false };
  if (/phone/i.test(message)) return { field: "phone", title: "", message, retryable: false };
  if (/name/i.test(message)) return { field: "fullName", title: "", message, retryable: false };

  return { field: "form", title: "We couldn't complete your registration", message, retryable: false };
}
