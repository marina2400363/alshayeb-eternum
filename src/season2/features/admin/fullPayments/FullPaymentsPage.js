import React, { useEffect, useMemo, useRef, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import StatusBadge from "../../../components/StatusBadge";
import Button from "../../../components/Button";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import { formatDateTime } from "../utils/formatDate";
import useAdminSchools from "../schools/hooks/useAdminSchools";
import { markFullPaymentDone, revokeFullPaymentDone } from "../services/admin.api";
import useFullPayments from "./hooks/useFullPayments";
import FullPaymentDetails from "./FullPaymentDetails";
import DecisionDialog from "./DecisionDialog";
import "../components/admin-shared.css";
import "./FullPaymentsPage.css";

const SEARCH_DEBOUNCE_MS = 300;
const NO_FILTERS = { customerType: "all", schoolId: "", manual: "all" };
const COLUMN_COUNT = 6;

// EVERY registered customer with their payment information, and the one manual
// control the Admin has: marking each customer's Full Payment DONE (or revoking
// it) one at a time. Nothing on this page decides anything from the amounts:
// the ticket price and the approved total are shown side by side for the Admin
// to compare, and DONE / NOT DONE is only ever the Admin's own decision.
// Searching, filtering, counting and paging happen on the server, one page at
// a time; a customer's deposit history loads only when its row is expanded.
export default function FullPaymentsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(() => new Set());
  const [decision, setDecision] = useState(null); // { mode, customer }
  const appliedSearch = useRef("");
  const { schools } = useAdminSchools();

  // Wait for the admin to stop typing before asking the server; a new search or
  // filter starts again from page 1.
  useEffect(() => {
    const trimmed = search.trim();
    const timer = setTimeout(() => {
      if (trimmed === appliedSearch.current) return;
      appliedSearch.current = trimmed;
      setDebouncedSearch(trimmed);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      q: debouncedSearch,
      customerType: filters.customerType === "all" ? "" : filters.customerType,
      schoolId: filters.customerType === "outcomer" ? "" : filters.schoolId,
      manual: filters.manual === "all" ? "" : filters.manual
    }),
    [page, pageSize, debouncedSearch, filters]
  );
  const { status, customers, pagination, error, retry, patchCustomer } = useFullPayments(params);

  const hasActiveFilter =
    Boolean(debouncedSearch) || filters.customerType !== "all" || Boolean(filters.schoolId) || filters.manual !== "all";

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function clearAll() {
    setSearch("");
    appliedSearch.current = "";
    setDebouncedSearch("");
    setFilters(NO_FILTERS);
    setPage(1);
  }

  function toggleExpanded(id) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Runs the confirmed decision for ONE customer. The row changes only after
  // the server confirms; on failure the dialog stays open with the error.
  async function applyDecision(customer) {
    const result =
      decision.mode === "done" ? await markFullPaymentDone(customer.id) : await revokeFullPaymentDone(customer.id);
    patchCustomer(customer.id, {
      manualStatus: result.manualStatus,
      doneAt: result.doneAt || null,
      doneBy: result.doneBy || null
    });
    setDecision(null);
  }

  if (status === "loading" && customers.length === 0 && !hasActiveFilter) {
    return <LoadingState label="Loading customers" />;
  }

  const firstShown = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastShown = (pagination.page - 1) * pagination.pageSize + customers.length;
  const outcomerView = filters.customerType === "outcomer";

  return (
    <div className="s2-admin-page s2-fp-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Full Payments</h1>
          <p className="s2-admin-page-subtitle">
            Every registered customer and what they have paid. You decide each Full Payment yourself: compare the ticket
            price with the approved deposits, then mark DONE. Nothing here is automatic.
          </p>
        </div>
        <span className="s2-admin-muted-text" aria-live="polite">
          {pagination.total.toLocaleString("en-US")} {pagination.total === 1 ? "customer" : "customers"}
          {hasActiveFilter ? " match" : ""}
        </span>
      </div>

      <div className="s2-fp-toolbar">
        <input
          className="s2-admin-input s2-fp-search"
          type="search"
          aria-label="Search customers"
          placeholder="Search name, phone or customer ID…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="s2-admin-input s2-fp-filter"
          aria-label="Customer type"
          value={filters.customerType}
          onChange={(event) => setFilter("customerType", event.target.value)}
        >
          <option value="all">All customers</option>
          <option value="incomer">Incomers</option>
          <option value="outcomer">Outcomers</option>
        </select>
        <select
          className="s2-admin-input s2-fp-filter"
          aria-label="Filter by school"
          value={filters.schoolId}
          disabled={outcomerView}
          onChange={(event) => setFilter("schoolId", event.target.value)}
        >
          <option value="">All schools</option>
          {schools.map((school) => (
            <option key={school._id} value={school._id}>
              {school.name}
            </option>
          ))}
        </select>
        <select
          className="s2-admin-input s2-fp-filter"
          aria-label="Filter by event"
          value=""
          disabled
          title="Outcomer registration is not live yet, so there are no events to filter by."
          onChange={() => {}}
        >
          <option value="">All events (not live)</option>
        </select>
        <select
          className="s2-admin-input s2-fp-filter"
          aria-label="Manual confirmation"
          value={filters.manual}
          onChange={(event) => setFilter("manual", event.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="done">DONE</option>
          <option value="not_done">NOT DONE</option>
        </select>
        <select
          className="s2-admin-input s2-fp-size"
          aria-label="Customers per page"
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
        >
          <option value={25}>25 per page</option>
          <option value={50}>50 per page</option>
        </select>
        {hasActiveFilter && (
          <button type="button" className="s2-admin-icon-btn" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>

      {status === "error" ? (
        <ErrorState title="Couldn't load customers" message={error?.message} onRetry={retry} />
      ) : customers.length === 0 ? (
        status === "loading" ? (
          <LoadingState label="Loading customers" />
        ) : (
          <p className="s2-admin-muted-text">
            {outcomerView
              ? "Outcomer registration is not live yet, so there are no Outcomer customers to show."
              : hasActiveFilter
                ? "No customers match this search."
                : "No customers have registered yet."}
          </p>
        )
      ) : (
        <div className={`s2-admin-table-overflow ${status === "loading" ? "is-refreshing" : ""}`}>
          <table className="s2-admin-table s2-admin-table--stacks s2-fp-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone / Customer ID</th>
                <th>Type / School or Event</th>
                <th className="s2-fp-num">Full ticket price</th>
                <th className="s2-fp-num">Approved deposits</th>
                <th>Full Payment</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => {
                const isOpen = expanded.has(customer.id);
                const isDone = customer.manualStatus === "DONE";
                return (
                  <React.Fragment key={customer.id}>
                    <tr className={isOpen ? "is-open" : ""}>
                      <td data-label="Customer" className="s2-fp-name-cell">
                        <span className="s2-fp-name">{customer.fullName}</span>
                        <div className="s2-fp-actions">
                          <button
                            type="button"
                            className="s2-admin-icon-btn"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "View"} deposits for ${customer.fullName}`}
                            onClick={() => toggleExpanded(customer.id)}
                          >
                            {isOpen ? "Hide Deposits" : "View Deposits"}
                          </button>
                          {isDone ? (
                            <button
                              type="button"
                              className="s2-admin-icon-btn s2-admin-icon-btn--danger"
                              aria-label={`Revoke DONE for ${customer.fullName}`}
                              onClick={() => setDecision({ mode: "revoke", customer })}
                            >
                              Revoke DONE
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="s2-admin-icon-btn s2-fp-done-btn"
                              aria-label={`Mark Full Payment DONE for ${customer.fullName}`}
                              onClick={() => setDecision({ mode: "done", customer })}
                            >
                              Mark Full Payment DONE
                            </button>
                          )}
                        </div>
                      </td>
                      <td data-label="Phone / ID">
                        <div className="s2-fp-stack">
                          <span className="s2-fp-stack-main">{customer.phone || "—"}</span>
                          <code className="s2-fp-id">{customer.id}</code>
                        </div>
                      </td>
                      <td data-label="Type / School">
                        <div className="s2-fp-stack">
                          <span className="s2-fp-stack-main">{customer.customerType === "outcomer" ? "Outcomer" : "Incomer"}</span>
                          <span className="s2-fp-stack-sub">{customer.eventName || customer.schoolName || "—"}</span>
                        </div>
                      </td>
                      <td data-label="Ticket price" className="s2-fp-num">
                        {customer.ticketPrice === null ? "—" : formatCurrency(customer.ticketPrice)}
                      </td>
                      <td data-label="Approved deposits" className="s2-fp-num">
                        {formatCurrency(customer.approvedTotalPaid)}
                      </td>
                      <td data-label="Full Payment">
                        <StatusBadge status={isDone ? "success" : "neutral"}>{isDone ? "DONE" : "NOT DONE"}</StatusBadge>
                        {isDone && customer.doneAt && (
                          <span className="s2-fp-done-meta">
                            {formatDateTime(customer.doneAt)}
                            {customer.doneBy ? ` · ${customer.doneBy}` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="s2-fp-detail-row">
                        <td colSpan={COLUMN_COUNT}>
                          <FullPaymentDetails customerId={customer.id} manualStatus={customer.manualStatus} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {status !== "error" && pagination.total > 0 && (
        <nav className="s2-fp-pager" aria-label="Pagination">
          <span className="s2-admin-muted-text">
            Showing {firstShown.toLocaleString("en-US")}–{lastShown.toLocaleString("en-US")} of{" "}
            {pagination.total.toLocaleString("en-US")}
          </span>
          <div className="s2-admin-action-row">
            <Button
              variant="secondary"
              size="sm"
              disabled={pagination.page <= 1 || status === "loading"}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <span className="s2-fp-pager-page">
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

      {decision && (
        <DecisionDialog
          mode={decision.mode}
          customer={decision.customer}
          onCancel={() => setDecision(null)}
          onConfirm={applyDecision}
        />
      )}
    </div>
  );
}
