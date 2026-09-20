import React from "react";
import useCustomer from "../hooks/useCustomer";
import { maskPhone } from "../utils/phone";
import "../onboarding.css";

// Who is signed in, and a way out. Session-only UI: it carries no payment,
// ticket or registration content, so it sits above whatever the Customer
// Area body shows. Signing out only clears the session — CustomerAreaGate
// performs the redirect.
export default function CustomerSessionBar() {
  const { customer, signOut } = useCustomer();

  if (!customer) return null;

  return (
    <div className="s2-ob-sessionbar">
      <div className="s2-ob-sessionbar-who">
        <span className="s2-ob-sessionbar-label">Signed in as</span>
        <span className="s2-ob-sessionbar-name">{customer.fullName || "Incomer"}</span>
        <span className="s2-ob-sessionbar-phone">{maskPhone(customer.phone)}</span>
      </div>
      <button type="button" className="s2-ob-textbtn" onClick={signOut}>
        Not you? Sign out
      </button>
    </div>
  );
}
