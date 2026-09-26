import React, { useEffect, useMemo, useRef, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import StatusBadge from "../../../components/StatusBadge";
import Button from "../../../components/Button";
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

const PAGE_SIZES = [25, 50, 100];
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_BADGE_VARIANT = { pending: "pending", approved: "success", rejected: "declined" };

function formatDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// One PAGE of deposits at a time (25 by default). The status tab, the search
// (customer name, phone or School) and the paging are all handled by the server
// across every deposit; the browser only ever holds the page on screen. Images
// are never loaded by the list — only the details panel, for the one deposit
// that is open.
export default function DepositsPage() {
  const [tab, setTab] = useState("pending");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [selectedId, setSelectedId] = useState(null);
  const appliedQuery = useRef("");

  // Wait for the admin to stop typing before asking the server; a new search
  // starts again from page 1 (set in the same update, so no request is wasted).
  useEffect(() => {
    const trimmed = query.trim();
    const timer = setTimeout(() => {
      if (trimmed === appliedQuery.current) return;
      appliedQuery.current = trimmed;
      setDebouncedQuery(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const params = useMemo(
    () => ({ status: tab, page, pageSize, q: debouncedQuery }),
    [tab, page, pageSize, debouncedQuery]
  );
  const { status, deposits, pagination, error, retry, approve, reject } = useAdminDeposits(params);

  // Reviewing the last deposit on a page (e.g. the only pending one on page 3)
  // leaves that page empty: step back to the last page that still exists.
  useEffect(() => {
    if (status === "ready" && deposits.length === 0 && pagination.total > 0 && page > pagination.totalPages) {
      setPage(pagination.totalPages);
    }
  }, [status, deposits.length, pagination.total, pagination.totalPages, page]);

  const hasSearch = Boolean(debouncedQuery);
  const selectedDeposit = deposits.find((d) => d._id === selectedId) || null;

  if (status === "loading" && deposits.length === 0 && !hasSearch && tab === "pending" && page === 1) {
    return <LoadingState label="Loading deposits" />;
  }

  const firstShown = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastShown = (pagination.page - 1) * pagination.pageSize + deposits.length;

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Deposits</h1>
          <p className="s2-admin-page-subtitle">Review, approve or reject customer payment submissions.</p>
        </div>
        <span className="s2-admin-muted-text" aria-live="polite">
          {pagination.total.toLocaleString("en-US")} {pagination.total === 1 ? "deposit" : "deposits"}
        </span>
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
                setPage(1);
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

      {status === "error" ? (
        <ErrorState title="Couldn't load deposits" message={error?.message} onRetry={retry} />
      ) : deposits.length === 0 ? (
        status === "loading" ? (
          <LoadingState label="Loading deposits" />
        ) : (
          <p className="s2-admin-muted-text">No deposits match this view.</p>
        )
      ) : (
        <div className="s2-admin-split s2-dep-split">
          <div className={`s2-admin-table-overflow ${status === "loading" ? "is-refreshing" : ""}`}>
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
                {deposits.map((deposit) => {
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

      {status !== "error" && pagination.total > 0 && (
        <nav className="s2-dep-pager" aria-label="Pagination">
          <span className="s2-admin-muted-text">
            Showing {firstShown.toLocaleString("en-US")}–{lastShown.toLocaleString("en-US")} of{" "}
            {pagination.total.toLocaleString("en-US")}
          </span>
          <div className="s2-dep-pager-controls">
            <label className="s2-dep-pagesize">
              <span className="s2-admin-field-label">Rows</span>
              <select
                className="s2-admin-input"
                aria-label="Rows per page"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" size="sm" disabled={pagination.page <= 1 || status === "loading"} onClick={() => setPage((current) => current - 1)}>
              Previous
            </Button>
            <span className="s2-dep-pager-page">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page >= pagination.totalPages || status === "loading"}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
