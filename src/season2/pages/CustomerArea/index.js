import React from "react";
import CustomerAreaShell from "../../features/customerArea/CustomerAreaShell";
import CustomerAreaGate from "../../features/onboarding/CustomerAreaGate";
import CustomerSessionBar from "../../features/onboarding/components/CustomerSessionBar";
import PaymentArea from "../../features/payments/PaymentArea";

// Route-level page stays thin: layout only. The gate (Marina) guarantees a
// signed-in customer before anything inside renders; the body is Sandra's
// payment experience — Sandra owns only this body, not the gate/shell/session bar.
export default function CustomerAreaPage() {
  return (
    <CustomerAreaGate>
      {/* Marina-owned wrapper: lets onboarding.css bring the shared shell into
          the same black, editorial world without editing the shell itself. */}
      <div className="s2-ob-ca">
        <CustomerAreaShell>
          <CustomerSessionBar />
          <PaymentArea />
        </CustomerAreaShell>
      </div>
    </CustomerAreaGate>
  );
}
