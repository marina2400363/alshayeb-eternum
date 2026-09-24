import React, { useEffect, useMemo, useRef, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import StatusBadge from "../../../components/StatusBadge";
import Button from "../../../components/Button";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import { customerPhotoThumbUrl } from "../deposits/customerPhoto";
import { formatDate } from "../utils/formatDate";
import useAdminSchools from "../schools/hooks/useAdminSchools";
import useAdminCustomers from "./hooks/useAdminCustomers";
import CustomerDetailPanel from "./CustomerDetailPanel";
import "../components/admin-shared.css";
import "./CustomersPage.css";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const NO_FILTERS = { schoolId: "", payment: "", fullPayment: "", from: "", to: "" };

// EVERY registered Season 2 Incomer — the list comes from the Attendee
// collection, so a customer who never chose a payment option, never uploaded a
// proof and has no Deposits at all still appears here. Searching, filtering and
// paging are all done by the server (one page at a time); this page never loads
// the whole customer base or joins anything itself.
export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const appliedSearch = useRef("");
  const { schools } = useAdminSchools();

  // Wait for the admin to stop typing before asking the server. A new search
  // (like a new filter) starts again from page 1, in the same update so no
  // request is wasted on "page 3 of the old search".
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
    () => ({ page, pageSize: PAGE_SIZE, q: debouncedSearch, ...filters }),
    [page, debouncedSearch, filters]
  );
  const { status, customers, pagination, error, retry } = useAdminCustomers(params);

  const hasActiveFilter = Boolean(debouncedSearch) || Object.values(filters).some(Boolean);

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

  if (status === "loading" && customers.length === 0 && !hasActiveFilter) {
    return <LoadingState label="Loading customers" />;
  }

  const firstShown = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const lastShown = (pagination.page - 1) * pagination.pageSize + customers.length;

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Registered Customers</h1>
          <p className="s2-admin-page-subtitle">
            Every registered Incomer — including those who haven't made any payment yet.
          </p>
        </div>
        <span className="s2-admin-muted-text" aria-live="polite">
          {pagination.total.toLocaleString("en-US")} {pagination.total === 1 ? "customer" : "customers"}
          {hasActiveFilter ? " match" : ""}
        </span>
      </div>

      <div className="s2-cust-toolbar">
        <input
          className="s2-admin-input s2-cust-search"
          type="search"
          aria-label="Search customers"
          placeholder="Search name, phone, email or customer ID…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className="s2-admin-input s2-cust-filter"
          aria-label="Filter by school"
          value={filters.schoolId}
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
          className="s2-admin-input s2-cust-filter"
          aria-label="Filter by approved payment"
          value={filters.payment}
          onChange={(event) => setFilter("payment", event.target.value)}
        >
          <option value="">Any payment</option>
          <option value="approved">Has approved payment</option>
          <option value="none">No approved payment</option>
        </select>
        <select
          className="s2-admin-input s2-cust-filter"
          aria-label="Filter by full payment"
          value={filters.fullPayment}
          onChange={(event) => setFilter("fullPayment", event.target.value)}
        >
          <option value="">Any full payment status</option>
          <option value="complete">Full payment complete</option>
          <option value="incomplete">Full payment not complete</option>
        </select>
        <label className="s2-cust-date">
          <span className="s2-admin-field-label">Registered from</span>
          <input
            className="s2-admin-input"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => setFilter("from", event.target.value)}
          />
        </label>
        <label className="s2-cust-date">
          <span className="s2-admin-field-label">to</span>
          <input
            className="s2-admin-input"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => setFilter("to", event.target.value)}
          />
        </label>
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
            {hasActiveFilter ? "No customers match this search." : "No customers have registered yet."}
          </p>
        )
      ) : (
        <div className={`s2-admin-table-overflow ${status === "loading" ? "is-refreshing" : ""}`}>
          <table className="s2-admin-table s2-admin-table--stacks s2-cust-table">
            <thead>
              <tr>
                <th aria-label="Photo" />
                <th>Customer ID</th>
                <th>Full name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>School</th>
                <th className="s2-cust-num">Ticket price</th>
                <th>Registered</th>
                <th className="s2-cust-num">Approved payments</th>
                <th className="s2-cust-num">Approved paid</th>
                <th>Full payment</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr
                  key={customer.id}
                  tabIndex={0}
                  className={customer.id === selectedId ? "is-selected" : ""}
                  onClick={() => setSelectedId(customer.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(customer.id);
                    }
                  }}
                >
                  <td className="s2-cust-photo-cell">
                    {customer.photoUrl ? (
                      // Lazy, decoded off-thread, and a ~72px rendition from Cloudinary —
                      // a whole page of rows costs only a few KB of images.
                      <img
                        className="s2-cust-thumb"
                        src={customerPhotoThumbUrl(customer.photoUrl, 72)}
                        alt=""
                        width="36"
                        height="36"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="s2-cust-thumb s2-cust-thumb--empty" aria-hidden="true" />
                    )}
                  </td>
                  <td data-label="Customer ID">
                    <code className="s2-cust-id">{customer.id}</code>
                  </td>
                  <td data-label="Full name" className="s2-cust-name-cell">
                    {customer.fullName}
                  </td>
                  <td data-label="Phone">{customer.phone || "—"}</td>
                  <td data-label="Email">{customer.email || "—"}</td>
                  <td data-label="School">{customer.schoolName || "—"}</td>
                  <td data-label="Ticket price" className="s2-cust-num">
                    {customer.ticketPrice === null ? "—" : formatCurrency(customer.ticketPrice)}
                  </td>
                  <td data-label="Registered">{formatDate(customer.registeredAt)}</td>
                  <td data-label="Approved payments" className="s2-cust-num">
                    {customer.approvedPaymentCount}
                  </td>
                  <td data-label="Approved paid" className="s2-cust-num">
                    {formatCurrency(customer.approvedTotalPaid)}
                  </td>
                  <td data-label="Full payment">
                    <StatusBadge status={customer.fullPaymentComplete ? "success" : "neutral"}>
                      {customer.fullPaymentComplete ? "Complete" : "Not complete"}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status !== "error" && pagination.total > 0 && (
        <nav className="s2-cust-pager" aria-label="Pagination">
          <span className="s2-admin-muted-text">
            Showing {firstShown.toLocaleString("en-US")}–{lastShown.toLocaleString("en-US")} of{" "}
            {pagination.total.toLocaleString("en-US")}
          </span>
          <div className="s2-admin-action-row">
            <Button variant="secondary" size="sm" disabled={pagination.page <= 1 || status === "loading"} onClick={() => setPage((current) => current - 1)}>
              Previous
            </Button>
            <span className="s2-cust-pager-page">
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

      {selectedId && <CustomerDetailPanel customerId={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
