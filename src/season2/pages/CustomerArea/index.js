import React from "react";
import CustomerAreaShell from "../../features/customerArea/CustomerAreaShell";
import CustomerAreaGate from "../../features/onboarding/CustomerAreaGate";
import CustomerSessionBar from "../../features/onboarding/components/CustomerSessionBar";
import { EmptyState } from "../../components";

// Route-level page stays thin: layout only, no payment/registration logic.
// The gate (Marina) guarantees a signed-in customer before anything inside
// renders; the body below is still the Phase 1A placeholder for payment work.
export default function CustomerAreaPage() {
  return (
    <CustomerAreaGate>
      {/* Marina-owned wrapper: lets onboarding.css bring the shared shell into
          the same black, editorial world without editing the shell itself. */}
      <div className="s2-ob-ca">
        <CustomerAreaShell>
          <CustomerSessionBar />
          <EmptyState
            title="Customer Area"
            message="Structure only — onboarding and payment flows are built in a later phase."
          />
        </CustomerAreaShell>
      </div>
    </CustomerAreaGate>
  );
}
