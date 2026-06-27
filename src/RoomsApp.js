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
            <div className="rooms-step">
              <button className="rooms-back-button" onClick={() => handleBack("dates")}>← Back</button>
              <h2 className="rooms-step-title">Choose Room Type</h2>
              {loading ? <p className="rooms-loading">Loading room types...</p> : (
                <div className="rooms-list">
                  {roomTypes.map(r => (
                    <div key={r._id} className="rooms-card">
                      <div className="rooms-card-header">
                        <span className={`rooms-badge ${r.status === 'available' ? 'rooms-badge-available' : 'rooms-badge-unavailable'}`}>
                          {r.status === 'available' ? 'Available' : 'Unavailable'}
                        </span>
                        {r.breakfastIncluded && <span className="rooms-badge rooms-badge-breakfast">Breakfast Included</span>}
                      </div>
                      <h3 className="rooms-card-title">{r.name}</h3>
                      <div className="rooms-card-details">
                        <span>Capacity: {r.capacity}</span>
                        <span>{r.pricePerNight} EGP / night</span>
                      </div>
                      <button 
                        className="eternum-button primary" 
                        disabled={r.status !== 'available'}
                        onClick={() => { setSelectedRoom(r); handleNext("guest"); }}
                      >
                        SELECT
                      </button>
                    </div>
                  ))}
                  {roomTypes.length === 0 && <p>No room types available for this hotel.</p>}
                </div>
              )}
            </div>
          )}

          {step === "guest" && (
            <div className="rooms-step">
              <button className="rooms-back-button" onClick={() => handleBack("rooms")}>← Back</button>
              <h2 className="rooms-step-title">Guest Details</h2>
              <div className="rooms-form-group">
                <label>Full Name</label>
                <input type="text" className="eternum-input" value={guestDetails.fullName} onChange={e => setGuestDetails({...guestDetails, fullName: e.target.value})} placeholder="Enter your full name" />
              </div>
              <div className="rooms-form-group">
                <label>Phone Number</label>
                <input type="tel" className="eternum-input" value={guestDetails.phoneNumber} onChange={e => setGuestDetails({...guestDetails, phoneNumber: e.target.value})} placeholder="01XXXXXXXXX" />
              </div>
              <div className="rooms-form-group">
                <label>Email Address</label>
                <input type="email" className="eternum-input" value={guestDetails.emailAddress} onChange={e => setGuestDetails({...guestDetails, emailAddress: e.target.value})} placeholder="you@example.com" />
              </div>
              <div className="rooms-form-group">
                <label>Nationality</label>
                <input type="text" className="eternum-input" value="Egyptian" disabled style={{opacity: 0.7}} />
              </div>
              <button 
                className="eternum-button primary" 
                style={{marginTop: "1rem"}}
                onClick={() => {
                  if (!guestDetails.fullName || !guestDetails.phoneNumber) {
                    setError("Full Name and Phone Number are required.");
                    return;
                  }
                  handleNext("payment");
                }}
              >
                PROCEED TO PAYMENT
              </button>
            </div>
          )}

          {step === "payment" && (
            <div className="rooms-step">
              <button className="rooms-back-button" onClick={() => handleBack("guest")}>← Back</button>
              <h2 className="rooms-step-title">Payment & Summary</h2>
              
              <div className="rooms-summary-card">
                <h3>Reservation Summary</h3>
                <div className="rooms-summary-row"><span>Hotel:</span> <span>{selectedHotel?.name}</span></div>
                <div className="rooms-summary-row"><span>Room:</span> <span>{selectedRoom?.name}</span></div>
                <div className="rooms-summary-row"><span>Check-in:</span> <span>{selectedDates.checkIn}</span></div>
                <div className="rooms-summary-row"><span>Check-out:</span> <span>{selectedDates.checkOut}</span></div>
                <div className="rooms-summary-row"><span>Duration:</span> <span>{stayDuration} night(s)</span></div>
                <div className="rooms-summary-row"><span>Price/Night:</span> <span>{selectedRoom?.pricePerNight} EGP</span></div>
                <div className="rooms-summary-divider"></div>
                <div className="rooms-summary-total"><span>Total Amount:</span> <span>{stayDuration * (selectedRoom?.pricePerNight || 0)} EGP</span></div>
              </div>

              <div className="rooms-payment-instructions" style={{ marginTop: '2rem' }}>
                <p>Please pay the total amount via Instapay to the following address:</p>
                <div className="rooms-instapay-box">
                  alshayeb@instapay
                </div>
              </div>

              <div className="rooms-button-group" style={{marginTop: "2rem"}}>
                <a href="instapay://pay?pa=alshayeb@instapay" className="eternum-button secondary" target="_blank" rel="noopener noreferrer">
                  GO TO INSTAPAY
                </a>
                <button className="eternum-button primary" onClick={submitReservation} disabled={loading}>
                  {loading ? "PROCESSING..." : "I HAVE MADE THE PAYMENT"}
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
