import React from "react";
import CustomerAreaShell from "../../features/customerArea/CustomerAreaShell";
import CustomerAreaGate from "../../features/onboarding/CustomerAreaGate";
import CustomerSessionBar from "../../features/onboarding/components/CustomerSessionBar";
import PaymentArea from "../../features/payments/PaymentArea";
import StatusCounter from "../../features/customerArea/StatusCounter";
import GateAccessAction from "../../features/customerArea/GateAccessAction";
import "./CustomerArea.css";

// Route-level page stays thin: layout only. The gate (Marina) guarantees a
// signed-in customer before anything inside renders; the main column is
// Sandra's untouched payment experience. StatusCounter and GateAccessAction
// are new, independent additions placed in the column beside it — neither
// reads from nor changes payment state.
export default function CustomerAreaPage() {
  return (
    <CustomerAreaGate>
      {/* Marina-owned wrapper: lets onboarding.css bring the shared shell into
          the same black, editorial world without editing the shell itself. */}
      <div className="s2-ob-ca">
        <CustomerAreaShell>
          <div className="s2-ca-layout">
            <div className="s2-ca-main">
              <CustomerSessionBar />
              <PaymentArea />
            </div>
            <aside className="s2-ca-side">
              <StatusCounter />
              <GateAccessAction />
            </aside>
          </div>
        </CustomerAreaShell>
      </div>
    </CustomerAreaGate>
  );
}
