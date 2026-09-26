import React, { useEffect, useState } from "react";
import LoadingState from "../../../components/LoadingState";
import ErrorState from "../../../components/ErrorState";
import Button from "../../../components/Button";
import { formatCurrency } from "../../payments/utils/formatCurrency";
import useAdminSchools from "./hooks/useAdminSchools";
import PaymentOptionsEditor from "./PaymentOptionsEditor";
import "../components/admin-shared.css";
import "./SchoolsPage.css";

// Schools created before the setting existed show the price (the default).
function priceVisible(school) {
  return school.showTicketPriceToCustomer !== false;
}

function parsePrice(raw) {
  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) return null;
  return price;
}

export default function SchoolsPage() {
  const { status, schools, error, retry, addSchool, editSchool } = useAdminSchools();
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    if (!selectedId && schools.length > 0) {
      setSelectedId(schools[0]._id);
    }
  }, [schools, selectedId]);

  const selectedSchool = schools.find((school) => school._id === selectedId) || null;

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [createError, setCreateError] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const [priceDraft, setPriceDraft] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [detailError, setDetailError] = useState("");
  const [detailSaving, setDetailSaving] = useState(null); // "name" | "price" | "visibility" | null

  useEffect(() => {
    if (selectedSchool) {
      setPriceDraft(String(selectedSchool.ticketPrice));
      setNameDraft(selectedSchool.name);
      setDetailError("");
    }
  }, [selectedSchool?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(event) {
    event.preventDefault();
    setCreateError("");
    const price = parsePrice(newPrice);
    if (!newName.trim()) {
      setCreateError("School name is required.");
      return;
    }
    if (price === null) {
      setCreateError("Enter a valid ticket price (0 or more).");
      return;
    }

    setCreateSubmitting(true);
    try {
      const school = await addSchool({ name: newName.trim(), ticketPrice: price });
      setNewName("");
      setNewPrice("");
      setCreating(false);
      setSelectedId(school._id);
    } catch (failure) {
      setCreateError(failure?.message || "Couldn't create this School.");
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleSaveName() {
    setDetailError("");
    if (!nameDraft.trim()) {
      setDetailError("School name is required.");
      return;
    }
    setDetailSaving("name");
    try {
      await editSchool(selectedSchool._id, { name: nameDraft.trim() });
    } catch (failure) {
      setDetailError(failure?.message || "Couldn't save the name.");
    } finally {
      setDetailSaving(null);
    }
  }

  async function handleSavePrice() {
    setDetailError("");
    const price = parsePrice(priceDraft);
    if (price === null) {
      setDetailError("Enter a valid ticket price (0 or more).");
      return;
    }
    setDetailSaving("price");
    try {
      await editSchool(selectedSchool._id, { ticketPrice: price });
    } catch (failure) {
      setDetailError(failure?.message || "Couldn't save the ticket price.");
    } finally {
      setDetailSaving(null);
    }
  }

  // Visibility only — never touches the ticket price or any payment data.
  async function handleToggleVisibility() {
    setDetailError("");
    setDetailSaving("visibility");
    try {
      await editSchool(selectedSchool._id, { showTicketPriceToCustomer: !priceVisible(selectedSchool) });
    } catch (failure) {
      setDetailError(failure?.message || "Couldn't change the ticket price visibility.");
    } finally {
      setDetailSaving(null);
    }
  }

  if (status === "loading") {
    return <LoadingState label="Loading schools" />;
  }

  if (status === "error") {
    return <ErrorState title="Couldn't load schools" message={error?.message} onRetry={retry} />;
  }

  return (
    <div className="s2-admin-page">
      <div className="s2-admin-page-header">
        <div>
          <h1 className="s2-admin-page-title">Schools</h1>
          <p className="s2-admin-page-subtitle">
            Full ticket price and payment options, per School. Every option belongs to exactly one School.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "+ New school"}
        </Button>
      </div>

      {creating && (
        <form className="s2-admin-panel s2-admin-inline-form" onSubmit={handleCreate}>
          <div className="s2-admin-field-row">
            <span className="s2-admin-field-label">Name</span>
            <input className="s2-admin-input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="s2-admin-field-row">
            <span className="s2-admin-field-label">Full ticket price</span>
            <input
              className="s2-admin-input"
              type="number"
              min="0"
              step="1"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
            />
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={createSubmitting}>
            {createSubmitting ? "Creating…" : "Create school"}
          </Button>
          {createError && (
            <p className="s2-admin-error-text" role="alert">
              {createError}
            </p>
          )}
        </form>
      )}

      {schools.length === 0 ? (
        <p className="s2-admin-muted-text">No schools yet. Create one to get started.</p>
      ) : (
        <div className="s2-admin-split">
          <div className="s2-admin-rail" role="listbox" aria-label="Schools">
            {schools.map((school) => (
              <button
                key={school._id}
                type="button"
                role="option"
                aria-selected={school._id === selectedId}
                className={`s2-admin-rail-item ${school._id === selectedId ? "is-selected" : ""}`}
                onClick={() => setSelectedId(school._id)}
              >
                <span className="s2-admin-rail-item-name">{school.name}</span>
                <span className="s2-admin-rail-item-meta">
                  {formatCurrency(school.ticketPrice)}
                  {!priceVisible(school) && " · price hidden"}
                </span>
              </button>
            ))}
          </div>

          {selectedSchool && (
            <div>
              <div className="s2-admin-panel">
                <span className="s2-admin-eyebrow">School</span>

                <div className="s2-admin-field-row">
                  <span className="s2-admin-field-label">Name</span>
                  <div className="s2-admin-inline-form">
                    <input className="s2-admin-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
                    <Button variant="ghost" size="sm" disabled={detailSaving === "name"} onClick={handleSaveName}>
                      {detailSaving === "name" ? "Saving…" : "Save"}
                    </Button>
                  </div>
                </div>

                <div className="s2-admin-field-row">
                  <span className="s2-admin-field-label">Full ticket price</span>
                  <div className="s2-admin-inline-form">
                    <input
                      className="s2-admin-input"
                      type="number"
                      min="0"
                      step="1"
                      value={priceDraft}
                      onChange={(e) => setPriceDraft(e.target.value)}
                    />
                    <Button variant="ghost" size="sm" disabled={detailSaving === "price"} onClick={handleSavePrice}>
                      {detailSaving === "price" ? "Saving…" : "Save"}
                    </Button>
                  </div>
                  <p className="s2-admin-muted-text">
                    Customers who haven't made a payment request yet move to the new price. A customer's price
                    locks at their first payment request — after that, changes here never affect them.
                  </p>
                </div>

                <div className="s2-admin-field-row">
                  <span className="s2-admin-field-label" id="s2-price-visibility-label">
                    Show ticket price to customer
                  </span>
                  <div className="s2-admin-inline-form">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={priceVisible(selectedSchool)}
                      aria-labelledby="s2-price-visibility-label"
                      className={`s2-price-switch ${priceVisible(selectedSchool) ? "is-on" : ""}`}
                      disabled={detailSaving === "visibility"}
                      onClick={handleToggleVisibility}
                    >
                      <span className="s2-price-switch-track" aria-hidden="true">
                        <span className="s2-price-switch-thumb" />
                      </span>
                      <span className="s2-price-switch-text">{priceVisible(selectedSchool) ? "Shown" : "Hidden"}</span>
                    </button>
                  </div>
                  <p className="s2-admin-muted-text">
                    When hidden, customers of this School don't see a ticket price at all — it isn't sent to their
                    screen. Payments and finance are unaffected.
                  </p>
                </div>

                {detailError && (
                  <p className="s2-admin-error-text" role="alert">
                    {detailError}
                  </p>
                )}
              </div>

              <PaymentOptionsEditor key={selectedSchool._id} school={selectedSchool} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
