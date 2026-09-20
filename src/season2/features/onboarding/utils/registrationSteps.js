import { PATHS } from "../paths";
import { validateEmail, validateFullName, validatePhone } from "./validation";

// Registration order: Details -> School -> Photo + Confirm.

// Details is the first step: name, mobile number and email must all be valid.
export function detailsIncomplete(draft) {
  return Boolean(validateFullName(draft.fullName) || validatePhone(draft.phone) || validateEmail(draft.email));
}

// Which registration step must be completed first, given the draft. Used by
// the step routes so a refresh, a pasted URL or a stale tab can never land on
// a step whose prerequisites are missing:
//   • School needs valid Details
//   • Photo needs valid Details AND a chosen School
// Returns null when the draft is ready for the Photo + Confirm step.
export function firstIncompleteStep(draft) {
  if (detailsIncomplete(draft)) return PATHS.incomerNewDetails;
  if (!draft.schoolId) return PATHS.incomerNewSchool;
  return null;
}
