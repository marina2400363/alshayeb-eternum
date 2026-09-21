import React, { useMemo, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import StatusBadge from "../../../components/StatusBadge";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import useAdminDeposits from "./hooks/useAdminDeposits";
import DepositDetailPanel from "./DepositDetailPanel";
import "../components/admin-shared.css";
import "./DepositsPage.css";

const TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" }
];

const STATUS_BADGE_VARIANT = { pending: "pending", approved: "success", rejected: "declined" };

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function DepositsPage() {
  const [tab, setTab] = useState("pending");
  const { status, deposits, error, retry, approve, reject } = useAdminDeposits(tab);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // Client-side only: GET /api/admin/deposits supports status + attendeeId
  // filters, not free-text search, so this filters the already-loaded page
  // rather than issuing a new query per keystroke.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deposits;
    return deposits.filter((deposit) => {
      const attendee = typeof deposit.attendeeId === "object" ? deposit.attendeeId : null;
      const schoolName = attendee?.schoolId && typeof attendee.schoolId === "object" ? attendee.schoolId.name : "";
      return (
        attendee?.fullName?.toLowerCase().includes(q) ||
        attendee?.phone?.toLowerCase().includes(q) ||
        schoolName.toLowerCase().includes(q)
      );
    });
  }, [deposits, query]);

  const selectedDeposit = filtered.find((d) => d._id === selectedId) || null;

  if (status === "loading" && deposits.length === 0) {
    return <LoadingState label="Loading deposits" />;
  }

  if (status === "error") {
    return <ErrorState title="Couldn't load deposits" message={error?.message} onRetry={retry} />;
  }

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Deposits</h1>
          <p className="s2-admin-page-subtitle">Review, approve or reject customer payment submissions.</p>
        </div>
      </div>

      <div className="s2-dep-toolbar">
        <div className="s2-dep-tabs" role="tablist" aria-label="Deposit status">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`s2-dep-tab ${tab === t.key ? "is-active" : ""}`}
              onClick={() => {
                setTab(t.key);
                setSelectedId(null);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="s2-admin-input s2-dep-search"
          type="search"
          placeholder="Search by name, phone or school…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="s2-admin-muted-text">No deposits match this view.</p>
      ) : (
        <div className="s2-admin-split s2-dep-split">
          <div className="s2-admin-table-overflow">
            <table className="s2-admin-table s2-admin-table--stacks">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>School</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((deposit) => {
                  const attendee = typeof deposit.attendeeId === "object" ? deposit.attendeeId : null;
                  const schoolName = attendee?.schoolId && typeof attendee.schoolId === "object" ? attendee.schoolId.name : "—";
                  return (
                    <tr
                      key={deposit._id}
                      className={deposit._id === selectedId ? "is-selected" : ""}
                      onClick={() => setSelectedId(deposit._id)}
                    >
                      <td data-label="Customer">{attendee?.fullName || "—"}</td>
                      <td data-label="School">{schoolName}</td>
                      <td data-label="Amount">{formatCurrency(deposit.amount)}</td>
                      <td data-label="Status">
                        <StatusBadge status={STATUS_BADGE_VARIANT[deposit.status] || "pending"}>{deposit.status}</StatusBadge>
                      </td>
                      <td data-label="Submitted">{formatDate(deposit.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedDeposit && (
            <DepositDetailPanel
              deposit={selectedDeposit}
              onApprove={approve}
              onReject={reject}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
