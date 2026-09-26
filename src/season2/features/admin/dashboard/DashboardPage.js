import React from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import StatusBadge from "../../../components/StatusBadge";
import Button from "../../../components/Button";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import { formatDateTime } from "../utils/formatDate";
import useAdminDashboard from "./hooks/useAdminDashboard";
import "../components/admin-shared.css";
import "./DashboardPage.css";

const DEPOSIT_BADGE = { pending: "pending", approved: "success", rejected: "declined" };

// Each KPI: its label, where the number lives in the API response, and the
// exact definition (also shown as a tooltip) so the number is never ambiguous.
const KPI_CARDS = [
  { key: "totalRegisteredIncomers", label: "Total Registered Incomers", hint: "Every Season 2 Incomer, whatever their payment activity." },
  { key: "registeredToday", label: "Registered Today", hint: "Incomers who registered today (Egypt time)." },
  { key: "customersWithNoApprovedPayment", label: "No Approved Payment Yet", hint: "Registered Incomers with zero approved deposits." },
  { key: "customersWithApprovedPayment", label: "With Approved Payment", hint: "Unique customers with at least one approved deposit." },
  { key: "fullPaymentComplete", label: "Full Payment Complete", hint: "Confirmed as DONE by the accountant." },
  { key: "pendingDeposits", label: "Pending Deposits", hint: "Deposits waiting for review." },
  { key: "approvedDeposits", label: "Approved Deposits", hint: "Deposits approved by an admin." },
  { key: "rejectedDeposits", label: "Rejected Deposits", hint: "Deposits rejected by an admin." },
  { key: "totalApprovedAmount", label: "Total Approved Amount", hint: "Sum of approved deposits only.", currency: true },
  { key: "totalSchools", label: "Total Schools", hint: "Every School set up in Admin." }
];

const SCHOOL_COLUMNS = [
  { key: "totalRegistered", label: "Registered" },
  { key: "noApprovedPayment", label: "No approved payment" },
  { key: "withApprovedPayment", label: "With approved payment" },
  { key: "fullPaymentComplete", label: "Full payment" },
  { key: "pendingDeposits", label: "Pending deposits" },
  { key: "approvedDeposits", label: "Approved deposits" },
  { key: "totalApprovedAmount", label: "Approved amount", currency: true }
];

function formatCount(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function RecentList({ title, rows, emptyText, renderMeta }) {
  return (
    <section className="s2-admin-panel s2-dash-recent" aria-label={title}>
      <span className="s2-admin-eyebrow">{title}</span>
      {rows.length === 0 ? (
        <p className="s2-admin-muted-text">{emptyText}</p>
      ) : (
        <ul className="s2-dash-recent-list">
          {rows.map((row) => (
            <li key={row.id} className="s2-dash-recent-item">
              <span className="s2-dash-recent-main">
                <span className="s2-dash-recent-name">{row.fullName}</span>
                <span className="s2-dash-recent-meta">{renderMeta(row)}</span>
              </span>
              <span className="s2-dash-recent-time">{formatDateTime(row.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Default landing page of the Season 2 Admin Portal: a real-data overview.
// Read-only — it changes nothing, and never recomputes a number the backend
// already aggregated from MongoDB.
export default function DashboardPage() {
  const { status, dashboard, error, refresh } = useAdminDashboard();

  if (status === "loading" && !dashboard) {
    return <LoadingState label="Loading dashboard" />;
  }

  if (status === "error" && !dashboard) {
    return <ErrorState title="Couldn't load the dashboard" message={error?.message} onRetry={refresh} />;
  }

  const { kpis, schools, recent } = dashboard;

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Dashboard</h1>
          <p className="s2-admin-page-subtitle">Live registrations and payments across every School.</p>
        </div>
        <div className="s2-dash-refresh">
          {dashboard.generatedAt && <span className="s2-admin-muted-text">Updated {formatDateTime(dashboard.generatedAt)}</span>}
          <Button variant="secondary" size="sm" disabled={status === "loading"} onClick={refresh}>
            {status === "loading" ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {status === "error" && (
        <p className="s2-admin-error-text" role="alert">
          {error?.message || "Couldn't refresh the dashboard."} Showing the last loaded numbers.
        </p>
      )}

      <section className="s2-dash-kpis" aria-label="Key numbers">
        {KPI_CARDS.map((card) => (
          <div key={card.key} className="s2-dash-kpi" title={card.hint}>
            <span className="s2-dash-kpi-label">{card.label}</span>
            <span className="s2-dash-kpi-value" data-testid={`kpi-${card.key}`}>
              {card.currency ? formatCurrency(kpis[card.key]) : formatCount(kpis[card.key])}
            </span>
          </div>
        ))}
      </section>

      <section aria-label="School breakdown">
        <span className="s2-admin-eyebrow">School breakdown</span>
        {schools.length === 0 ? (
          <p className="s2-admin-muted-text">No Schools have been set up yet.</p>
        ) : (
          <div className="s2-admin-table-overflow">
            <table className="s2-admin-table s2-admin-table--stacks s2-dash-schools">
              <thead>
                <tr>
                  <th>School</th>
                  {SCHOOL_COLUMNS.map((column) => (
                    <th key={column.key} className="s2-dash-num">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schools.map((school) => (
                  <tr key={school.schoolId || "none"}>
                    <td data-label="School" className="s2-dash-school-name">
                      {school.schoolName}
                    </td>
                    {SCHOOL_COLUMNS.map((column) => (
                      <td key={column.key} data-label={column.label} className="s2-dash-num">
                        {column.currency ? formatCurrency(school[column.key]) : formatCount(school[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Recent activity">
        <span className="s2-admin-eyebrow">Recent activity</span>
        <div className="s2-dash-recent-grid">
          <RecentList
            title="Latest registrations"
            rows={recent.registrations}
            emptyText="No registrations yet."
            renderMeta={(row) => row.schoolName || "No school"}
          />
          <RecentList
            title="Latest deposit submissions"
            rows={recent.depositSubmissions}
            emptyText="No deposits submitted yet."
            renderMeta={(row) => (
              <>
                {formatCurrency(row.amount)}{" "}
                <StatusBadge status={DEPOSIT_BADGE[row.status] || "pending"}>{row.status}</StatusBadge>
              </>
            )}
          />
          <RecentList
            title="Latest approved payments"
            rows={recent.approvedPayments}
            emptyText="No approved payments yet."
            renderMeta={(row) => formatCurrency(row.amount)}
          />
        </div>
      </section>
    </div>
  );
}
