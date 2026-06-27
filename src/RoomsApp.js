import React, { useState, useEffect, useCallback, useRef } from "react";
import RoomsDatePicker from "./RoomsDatePicker";

const LOCAL_API_URL = "http://127.0.0.1:5000";
const PROD_API_URL = "https://eternum-production.up.railway.app";
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BACKEND_API_URL = IS_LOCAL ? LOCAL_API_URL : PROD_API_URL;

async function apiFetch(path, options = {}) {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const hasBody = options.body !== undefined && options.body !== null;
  const isJsonRequest = hasBody && !isFormData;

  let response;
  try {
    response = await fetch(`${BACKEND_API_URL}${path}`, {
      ...options,
      headers: {
        ...(isJsonRequest ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
  } catch (networkError) {
    const error = new Error("Could not reach the backend API. Please try again in a moment.");
    error.cause = networkError;
    throw error;
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || result.reason || "Backend request failed.");
    error.details = result.details;
    throw error;
  }
  return result;
}


const RoomsSharedHeader = ({ step, handleBack, title, subtitle }) => {
  const steps = [
    { id: "hotels", num: 1, label: "HOTEL", back: "home" },
    { id: "dates", num: 2, label: "DATES", back: "hotels" },
    { id: "rooms", num: 3, label: "ROOM", back: "dates" },
    { id: "guest", num: 4, label: "DETAILS", back: "rooms" },
    { id: "payment", num: 5, label: "PAYMENT", back: "guest" }
  ];

  const currentStepIndex = steps.findIndex(s => s.id === step);
  if (currentStepIndex === -1) return null;

  const currentStepData = steps[currentStepIndex];

  return (
    <>
      <div className="rooms-top-nav">
        <button className="rooms-nav-back" onClick={() => handleBack(currentStepData.back)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="rooms-nav-brand">
          <div className="brand-alshayeb">ALSHAYEB</div>
          <div className="brand-subtitle">ROOM REGISTRATION</div>
        </div>
      </div>

      <div className="rooms-progress-container">
        <div className="rooms-progress-line"></div>
        <div className="rooms-progress-steps">
          {steps.map((s, idx) => {
            const isActive = idx === currentStepIndex;
            return (
              <div className={`rooms-progress-step ${isActive ? 'active' : ''}`} key={s.num}>
                <div className="rooms-progress-circle">
                   {isActive && <div className="rooms-progress-dot"></div>}
                </div>
                <div className="rooms-progress-num">{s.num}</div>
                <div className="rooms-progress-label">{s.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rooms-step-header">
        <div className="rooms-step-indicator-text">STEP {currentStepData.num} OF 5</div>
        <h2 className="rooms-step-title">{title}</h2>
        {subtitle && <p className="rooms-step-subtitle">{subtitle}</p>}
      </div>
    </>
  );
};

export default function RoomsApp() {
  const [step, setStep] = useState("home"); // home, hotels, dates, rooms, guest, payment, proof, submitted, my-reservations, reservation-details
  const [hotels, setHotels] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // Selections
  const [selectedHotel, setSelectedHotel] = useState(null);
  const [selectedDates, setSelectedDates] = useState({ checkIn: "", checkOut: "" });
  const [stayDuration, setStayDuration] = useState(0);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [guestDetails, setGuestDetails] = useState({ fullName: "", phoneNumber: "", emailAddress: "", nationality: "Egyptian" });
  const [paymentProof, setPaymentProof] = useState(null);
  const [reservation, setReservation] = useState(null);

  // My Reservations state
  const [lookupPhone, setLookupPhone] = useState("");
  const [myReservationsList, setMyReservationsList] = useState([]);

  // Fetch functions
  const loadHotels = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/rooms/hotels");
      setHotels(res.hotels || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadRoomTypes = async (hotelId) => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`/api/rooms/hotels/${hotelId}/room-types`);
      setRoomTypes(res.roomTypes || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateDuration = (inDate, outDate) => {
    if (!inDate || !outDate) return 0;
    const d1 = new Date(inDate);
    const d2 = new Date(outDate);
    if (isNaN(d1) || isNaN(d2) || d2 <= d1) return 0;
    const diff = Math.abs(d2 - d1);
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const handleNext = (nextStep) => {
    setError("");
    setStep(nextStep);
  };

  const handleBack = (prevStep) => {
    setError("");
    setStep(prevStep);
  };

  const submitReservation = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/rooms/reservations", {
        method: "POST",
        body: JSON.stringify({
          hotelId: selectedHotel._id,
          roomTypeId: selectedRoom._id,
          fullName: guestDetails.fullName,
          phoneNumber: guestDetails.phoneNumber,
          emailAddress: guestDetails.emailAddress,
          checkInDate: selectedDates.checkIn,
          checkOutDate: selectedDates.checkOut
        })
      });
      setReservation(res.reservation);
      handleNext("proof");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitProof = async () => {
    if (!paymentProof) {
      setError("Please select a file to upload.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("paymentProof", paymentProof);
      await apiFetch(`/api/rooms/reservations/${reservation._id}/proof`, {
        method: "POST",
        body: formData
      });
      handleNext("submitted");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const lookupReservations = async () => {
    if (!lookupPhone) {
      setError("Please enter your phone number.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/rooms/my-reservations", {
        method: "POST",
        body: JSON.stringify({ phoneNumber: lookupPhone })
      });
      setMyReservationsList(res.reservations || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="eternum-public-container rooms-platform">


      <div className="eternum-main-content">
        <div className="rooms-content-wrapper">
          {error && <div className="rooms-error-message">{error}</div>}

          {step === "home" && (
            <div className="rooms-homepage" style={{ backgroundImage: 'url("/rooms-homepage-bg.jpeg")', backgroundPosition: 'center top', backgroundRepeat: 'no-repeat', backgroundSize: '85% auto' }}>
              <div className="rooms-homepage-brand">
                <div className="brand-alshayeb">ALSHAYEB</div>
                <div className="brand-subtitle">ROOM REGISTRATION</div>
              </div>

              <div className="rooms-homepage-bottom">
                <div className="rooms-homepage-title-area">
                  <h1 className="rooms-homepage-title">ROOM<br />REGISTRATION</h1>
                  <div className="rooms-homepage-separator"></div>
                  <p className="rooms-homepage-desc">
                    Reserve your stay before<br />entering the experience.
                  </p>
                </div>

                <div className="rooms-homepage-actions">
                  <button className="rooms-btn-filled" onClick={() => { loadHotels(); handleNext("hotels"); }}>
                    BOOK A ROOM
                  </button>
                  <button className="rooms-btn-outline" onClick={() => handleNext("my-reservations")}>
                    MY RESERVATION
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "hotels" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader step={step} handleBack={handleBack} title="CHOOSE YOUR HOTEL" subtitle="Select your preferred hotel to continue" />

              {loading ? <p className="rooms-loading">Loading hotels...</p> : (
                <div className="rooms-hotel-list">
                  {hotels.map(h => {
                    const isAvailable = h.status === 'available';
                    return (
                      <div key={h._id} className="rooms-hotel-card">
                        <div className="rooms-hotel-info">
                          <h3 className="rooms-hotel-name">{h.name}</h3>
                        </div>
                        
                        <div className="rooms-hotel-divider"></div>
                        
                        <div className="rooms-hotel-action">
                          {!isAvailable && (
                            <div className="rooms-hotel-badge-na">NOT AVAILABLE</div>
                          )}
                          <div className="rooms-hotel-price">
                            <span className="price-label">Price starts from</span>
                            <span className="price-value">{h.startingPrice ? `${h.startingPrice.toLocaleString()} EGP` : '---'}</span>
                          </div>
                          {isAvailable && (
                            <button 
                              className="rooms-btn-select" 
                              onClick={() => { setSelectedHotel(h); handleNext("dates"); }}
                            >
                              SELECT
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {hotels.length === 0 && <p className="rooms-empty">No hotels available at the moment.</p>}
                </div>
              )}

              
            </div>
          )}

          {step === "dates" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader step={step} handleBack={handleBack} title="CHOOSE DATES" subtitle="Select your check-in and check-out dates" />
              
              <div className="rooms-dates-container">
                <div className="rooms-dates-summary">
                  <div className="rooms-dates-box">
                    <span className="rooms-dates-label">CHECK-IN</span>
                    <span className="rooms-dates-value">
                      {selectedDates.checkIn ? new Date(selectedDates.checkIn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Select Date'}
                    </span>
                  </div>
                  <div className="rooms-dates-divider">→</div>
                  <div className="rooms-dates-box">
                    <span className="rooms-dates-label">CHECK-OUT</span>
                    <span className="rooms-dates-value">
                      {selectedDates.checkOut ? new Date(selectedDates.checkOut).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Select Date'}
                    </span>
                  </div>
                </div>

                <RoomsDatePicker 
                  checkIn={selectedDates.checkIn} 
                  checkOut={selectedDates.checkOut} 
                  onChange={(inDate, outDate) => {
                    setSelectedDates({ checkIn: inDate, checkOut: outDate });
                    setStayDuration(calculateDuration(inDate, outDate));
                  }}
                />

                <div className="rooms-stay-summary">
                  {stayDuration > 0 ? (
                    <>
                      <span className="stay-duration-highlight">{stayDuration} Night{stayDuration > 1 ? 's' : ''}</span>
                      <span className="stay-duration-dates">
                        • {new Date(selectedDates.checkIn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} – {new Date(selectedDates.checkOut).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                    </>
                  ) : (
                    <span className="stay-duration-empty">Select dates to view stay duration</span>
                  )}
                </div>

                <button 
                  className="eternum-button primary rooms-continue-btn" 
                  disabled={stayDuration <= 0}
                  onClick={() => {
                    if (stayDuration > 0) {
                      loadRoomTypes(selectedHotel._id);
                      handleNext("rooms");
                    } else {
                      setError("Check-out date must be after check-in date.");
                    }
                  }}
                >
                  CONTINUE
                </button>
              </div>
            </div>
          )}

          {step === "rooms" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader step={step} handleBack={handleBack} title="CHOOSE ROOM" subtitle="Select your preferred room type" />
              
              {loading ? <p className="rooms-loading">Loading room types...</p> : (
                <div className="rooms-list-container">
                  {roomTypes.map(r => {
                    const isAvailable = r.status === 'available';
                    return (
                      <div key={r._id} className="rooms-hotel-card">
                        <div className="rooms-hotel-info">
                          <h3 className="rooms-hotel-name">{r.name}</h3>
                          <div className="rooms-type-meta">
                            <span className="rooms-capacity">Capacity: {r.capacity}</span>
                            {r.breakfastIncluded && <span className="rooms-breakfast-badge">Breakfast Included</span>}
                          </div>
                        </div>
                        
                        <div className="rooms-hotel-divider"></div>
                        
                        <div className="rooms-hotel-action">
                          {!isAvailable && (
                            <div className="rooms-hotel-badge-na">NOT AVAILABLE</div>
                          )}
                          <div className="rooms-hotel-price">
                            <span className="rooms-price-label">Price per night</span>
                            <span className="rooms-price-amount">{Number(r.pricePerNight).toLocaleString()} EGP</span>
                          </div>
                          {isAvailable && (
                            <button className="rooms-btn-select" onClick={() => { setSelectedRoom(r); handleNext("guest"); }}>
                              SELECT
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {roomTypes.length === 0 && <p className="rooms-empty-msg">No room types available for this hotel.</p>}
                </div>
              )}
            </div>
          )}

          {step === "guest" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader step={step} handleBack={handleBack} title="GUEST DETAILS" subtitle="Enter your contact information" />
              
              <div className="rooms-details-form-container">
                
                <div className="rooms-detail-box">
                  <div className="rooms-detail-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  </div>
                  <div className="rooms-detail-content">
                    <label className="rooms-detail-label">FULL NAME</label>
                    <input type="text" className="rooms-detail-input" value={guestDetails.fullName} onChange={e => setGuestDetails({...guestDetails, fullName: e.target.value})} placeholder="Enter full name" />
                  </div>
                </div>

                <div className="rooms-detail-box">
                  <div className="rooms-detail-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                  </div>
                  <div className="rooms-detail-content">
                    <label className="rooms-detail-label">PHONE NUMBER</label>
                    <input type="tel" className="rooms-detail-input" value={guestDetails.phoneNumber} onChange={e => setGuestDetails({...guestDetails, phoneNumber: e.target.value})} placeholder="+20 10 1234 5678" />
                  </div>
                </div>

                <div className="rooms-detail-box">
                  <div className="rooms-detail-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                  </div>
                  <div className="rooms-detail-content">
                    <label className="rooms-detail-label">EMAIL ADDRESS</label>
                    <input type="email" className="rooms-detail-input" value={guestDetails.emailAddress} onChange={e => setGuestDetails({...guestDetails, emailAddress: e.target.value})} placeholder="Enter email address" />
                  </div>
                </div>

                <div className="rooms-detail-box">
                  <div className="rooms-detail-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="4"></line><line x1="8" y1="2" x2="8" y2="4"></line><circle cx="9" cy="11" r="2"></circle><line x1="15" y1="11" x2="17" y2="11"></line><line x1="15" y1="14" x2="17" y2="14"></line><path d="M5 18h8"></path></svg>
                  </div>
                  <div className="rooms-detail-content">
                    <label className="rooms-detail-label">NATIONALITY</label>
                    <input type="text" className="rooms-detail-input" value="Egypt" disabled readOnly />
                  </div>
                </div>

                <button 
                  className="rooms-next-btn" 
                  disabled={!guestDetails.fullName || !guestDetails.phoneNumber || !guestDetails.emailAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestDetails.emailAddress)}
                  onClick={() => {
                    handleNext("payment");
                  }}
                >
                  NEXT <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              </div>
            </div>
          )}

          {step === "payment" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader step={step} handleBack={handleBack} title="PAYMENT" subtitle="Complete your reservation" />
              
              <div className="rooms-payment-container">
                <div className="rooms-summary-card">
                  <div className="rooms-card-header-small">RESERVATION SUMMARY</div>
                  
                  <div className="rooms-summary-list">
                    <div className="rooms-summary-item">
                      <span className="rooms-summary-label">Hotel</span>
                      <span className="rooms-summary-value highlight" style={{textTransform: 'uppercase'}}>{selectedHotel?.name}</span>
                    </div>
                    <div className="rooms-summary-item">
                      <span className="rooms-summary-label">Room Type</span>
                      <span className="rooms-summary-value" style={{textTransform: 'uppercase'}}>{selectedRoom?.name}</span>
                    </div>
                    <div className="rooms-summary-item">
                      <span className="rooms-summary-label">Nights</span>
                      <span className="rooms-summary-value">{stayDuration} Night{stayDuration > 1 ? 's' : ''}</span>
                    </div>
                    <div className="rooms-summary-item">
                      <span className="rooms-summary-label">Dates</span>
                      <span className="rooms-summary-value">
                        {selectedDates.checkIn ? new Date(selectedDates.checkIn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} – {selectedDates.checkOut ? new Date(selectedDates.checkOut).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                      </span>
                    </div>
                    
                    <div className="rooms-summary-divider" style={{margin: '0.5rem 0'}}></div>
                    
                    <div className="rooms-summary-item">
                      <span className="rooms-summary-label">Room Price ({selectedRoom?.pricePerNight} EGP x {stayDuration} Nights)</span>
                      <span className="rooms-summary-value">{(selectedRoom?.pricePerNight * stayDuration).toLocaleString()} EGP</span>
                    </div>
                    
                    <div className="rooms-summary-divider" style={{margin: '0.5rem 0'}}></div>
                    
                    <div className="rooms-summary-total-row">
                      <span className="rooms-summary-total-label">Total Amount</span>
                      <span className="rooms-summary-total-value">{(selectedRoom?.pricePerNight * stayDuration).toLocaleString()} EGP</span>
                    </div>
                  </div>
                </div>

                <div className="rooms-payment-card">
                  <div className="rooms-card-header-small">PAYMENT METHOD</div>
                  
                  <div className="rooms-payment-method-box">
                    <div className="rooms-payment-method-left">
                      <div className="rooms-instapay-icon">INSTA<br/>PAY</div>
                      <div className="rooms-payment-method-text">
                        <span className="rooms-payment-method-title">INSTAPAY</span>
                        <span className="rooms-payment-method-subtitle">Fast, secure and easy payments</span>
                      </div>
                    </div>
                    <div className="rooms-radio-selected">
                      <div className="rooms-radio-selected-inner"></div>
                    </div>
                  </div>
                  
                  <div className="rooms-card-header-small" style={{marginTop: '2rem'}}>PAYMENT INSTRUCTIONS</div>
                  
                  <div className="rooms-payment-instructions-list">
                    <div className="rooms-instruction-item">
                      <div className="rooms-instruction-number">1</div>
                      <div className="rooms-instruction-text">Open your InstaPay app.</div>
                    </div>
                    <div className="rooms-instruction-item">
                      <div className="rooms-instruction-number">2</div>
                      <div className="rooms-instruction-text">Send the total amount to complete your reservation.</div>
                    </div>
                    <div className="rooms-instruction-item">
                      <div className="rooms-instruction-number">3</div>
                      <div className="rooms-instruction-text">Upload the payment screenshot in the next step.</div>
                    </div>
                  </div>

                  <a href="instapay://pay?pa=alshayeb@instapay" className="rooms-go-instapay-btn" target="_blank" rel="noopener noreferrer">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: '0.5rem'}}><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    GO TO INSTAPAY
                  </a>
                </div>

                <div className="rooms-secure-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                  Your payment is secure and encrypted
                </div>

                <button 
                  className="rooms-confirm-payment-btn" 
                  onClick={submitReservation} 
                  disabled={loading}
                >
                  {loading ? "PROCESSING..." : "I HAVE MADE THE PAYMENT"} <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </button>
              </div>
            </div>
          )}

          {step === "proof" && (
            <div className="rooms-step">
              <h2 className="rooms-step-title">Upload Payment Proof</h2>
              <p style={{marginBottom: "2rem", textAlign: "center", color: "var(--eternum-text-dim)"}}>
                Please upload a screenshot of your successful Instapay transaction.
              </p>
              <div className="rooms-form-group">
                <input 
                  type="file" 
                  accept="image/png, image/jpeg, image/jpg, application/pdf" 
                  onChange={e => setPaymentProof(e.target.files[0])}
                  className="rooms-file-input"
                />
              </div>
              <button 
                className="eternum-button primary" 
                onClick={submitProof}
                disabled={loading || !paymentProof}
                style={{marginTop: "1rem"}}
              >
                {loading ? "UPLOADING..." : "SUBMIT PROOF"}
              </button>
            </div>
          )}

          {step === "submitted" && (
            <div className="rooms-step" style={{textAlign: 'center'}}>
              <h2 className="rooms-step-title" style={{color: "var(--eternum-primary)", marginTop: "2rem"}}>Reservation Pending</h2>
              <p style={{marginBottom: "2rem", color: "var(--eternum-text-dim)"}}>
                Your reservation ({reservation?.reservationId}) is under review. Our team will verify your payment and update the status shortly.
              </p>
              <button className="eternum-button primary" onClick={() => handleNext("home")}>
                RETURN HOME
              </button>
            </div>
          )}

          {step === "my-reservations" && (
            <div className="rooms-step">
              <button className="rooms-back-button" onClick={() => handleBack("home")}>← Back</button>
              <h2 className="rooms-step-title">My Reservations</h2>
              <div className="rooms-form-group">
                <label>Enter your Phone Number</label>
                <div style={{display: 'flex', gap: '1rem'}}>
                  <input type="tel" className="eternum-input" value={lookupPhone} onChange={e => setLookupPhone(e.target.value)} placeholder="01XXXXXXXXX" />
                  <button className="eternum-button primary" onClick={lookupReservations} disabled={loading} style={{width: 'auto'}}>
                    LOOKUP
                  </button>
                </div>
              </div>

              {myReservationsList.length > 0 && (
                <div className="rooms-list" style={{marginTop: "2rem"}}>
                  {myReservationsList.map(res => (
                    <div key={res._id} className="rooms-card">
                      <div className="rooms-card-header">
                        <span style={{fontSize: "0.8rem", color: "var(--eternum-text-dim)"}}>ID: {res.reservationId}</span>
                        <span className={`rooms-badge ${
                          res.reservationStatus === 'confirmed' ? 'rooms-badge-available' : 
                          res.reservationStatus === 'declined' ? 'rooms-badge-unavailable' : 'rooms-badge-pending'
                        }`}>
                          {res.reservationStatus.replace('_', ' ').toUpperCase()}
                        </span>
                      </div>
                      <h3 className="rooms-card-title">{res.hotelId?.name}</h3>
                      <p className="rooms-card-desc">{res.roomTypeId?.name}</p>
                      <div className="rooms-card-details" style={{marginTop: '1rem'}}>
                        <span>{new Date(res.checkInDate).toLocaleDateString()} - {new Date(res.checkOutDate).toLocaleDateString()}</span>
                        <span>{res.totalAmount} EGP</span>
                      </div>
                      <button 
                        className="eternum-button secondary" 
                        style={{marginTop: "1rem", width: "100%"}}
                        onClick={() => { setReservation(res); handleNext("reservation-details"); }}
                      >
                        VIEW DETAILS
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === "reservation-details" && reservation && (
            <div className="rooms-step">
              <button className="rooms-back-button" onClick={() => handleBack("my-reservations")}>← Back</button>
              <h2 className="rooms-step-title">Reservation Details</h2>
              <div className="rooms-summary-card">
                <div className="rooms-summary-row"><span>ID:</span> <span>{reservation.reservationId}</span></div>
                <div className="rooms-summary-row"><span>Status:</span> <span style={{textTransform:'capitalize'}}>{reservation.reservationStatus.replace('_', ' ')}</span></div>
                <div className="rooms-summary-row"><span>Payment:</span> <span style={{textTransform:'capitalize'}}>{reservation.paymentStatus.replace('_', ' ')}</span></div>
                <div className="rooms-summary-divider"></div>
                <div className="rooms-summary-row"><span>Hotel:</span> <span>{reservation.hotelId?.name || selectedHotel?.name}</span></div>
                <div className="rooms-summary-row"><span>Room:</span> <span>{reservation.roomTypeId?.name || selectedRoom?.name}</span></div>
                <div className="rooms-summary-row"><span>Guest:</span> <span>{reservation.fullName}</span></div>
                <div className="rooms-summary-row"><span>Phone:</span> <span>{reservation.phoneNumber}</span></div>
                <div className="rooms-summary-row"><span>Check-in:</span> <span>{new Date(reservation.checkInDate).toLocaleDateString()}</span></div>
                <div className="rooms-summary-row"><span>Check-out:</span> <span>{new Date(reservation.checkOutDate).toLocaleDateString()}</span></div>
                <div className="rooms-summary-row"><span>Duration:</span> <span>{reservation.stayDuration} night(s)</span></div>
                <div className="rooms-summary-divider"></div>
                <div className="rooms-summary-total"><span>Total Amount:</span> <span>{reservation.totalAmount} EGP</span></div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
