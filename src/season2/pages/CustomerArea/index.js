import React from "react";
import CustomerAreaShell from "../../features/customerArea/CustomerAreaShell";
import { EmptyState } from "../../components";

// Route-level page stays thin: layout only, no payment/registration logic.
export default function CustomerAreaPage() {
  return (
    <CustomerAreaShell>
      <EmptyState
        title="Customer Area"
        message="Structure only — onboarding and payment flows are built in a later phase."
      />
    </CustomerAreaShell>
  );
}
