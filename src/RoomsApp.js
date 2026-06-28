import React, { useState, useEffect, useCallback, useRef } from "react";
import RoomsDatePicker from "./RoomsDatePicker";

const LOCAL_API_URL = `http://${["127", "0", "0", "1"].join(".")}:5000`;
const CONFIGURED_API_URL = String(process.env.REACT_APP_API_URL || "").trim().replace(/\/$/, "");
const CONFIGURED_API_URL_IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(CONFIGURED_API_URL);
const BACKEND_API_URL = process.env.NODE_ENV === "production"
  ? (CONFIGURED_API_URL_IS_LOCAL ? "" : CONFIGURED_API_URL)
  : CONFIGURED_API_URL || LOCAL_API_URL;

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

  const mappedStep = step === "proof" ? "payment" : step === "submitted" ? "payment" : step;
  const currentStepIndex = steps.findIndex(s => s.id === mappedStep);
  const isStandalone = currentStepIndex === -1;
  const currentStepData = isStandalone ? null : steps[currentStepIndex];
  
  const backStep = step === "proof" ? "payment" : 
                   step === "submitted" ? "home" : 
                   step === "my-reservations" ? "home" : 
                   step === "reservation-details" ? "my-reservations" : 
                   isStandalone ? "home" : currentStepData.back;

  return (
    <>
      <div className="rooms-top-nav">
        <button className="rooms-nav-back" onClick={() => handleBack(backStep)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="rooms-nav-brand">
          <div className="brand-alshayeb">ALSHAYEB</div>
          <div className="brand-subtitle">ROOM REGISTRATION</div>
        </div>
      </div>

      {!isStandalone && (
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
      )}

      {title && (
        <div className="rooms-step-header">
          {!isStandalone && <div className="rooms-step-indicator-text">STEP {currentStepData.num} OF 5</div>}
          <h2 className="rooms-step-title">{title}</h2>
          {subtitle && <p className="rooms-step-subtitle">{subtitle}</p>}
        </div>
      )}
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
  const [guestDetails, setGuestDetails] = useState({ fullName: "", phoneNumber: "", nationalId: "", emailAddress: "", nationality: "Egyptian" });
  const [paymentProof, setPaymentProof] = useState(null);
  const [reservation, setReservation] = useState(null);

  // My Reservations state
  const [lookupPhone, setLookupPhone] = useState("");
  const [myReservationsList, setMyReservationsList] = useState([]);
  const [filterTab, setFilterTab] = useState("ALL");

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
          nationalId: guestDetails.nationalId,
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

  const compressImage = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Canvas is empty"));
              return;
            }
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          "image/jpeg",
          0.6
        );
      };

      img.onerror = (err) => {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      };

      img.src = objectUrl;
    });
  };

  const submitProof = async () => {
    if (!paymentProof) {
      setError("Please select a file to upload.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // If the file is already small (< 500KB), don't waste CPU compressing it
      let fileToUpload = paymentProof;
      if (paymentProof.size > 500 * 1024) {
        fileToUpload = await compressImage(paymentProof);
      }
      
      const formData = new FormData();
      formData.append("paymentProof", fileToUpload);
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
                          <h3 className="rooms-hotel-name">
                            {(() => {
                              const parts = h.name.split(' ');
                              if (parts.length === 1) return parts[0];
                              return (
                                <>
                                  <div>{parts[0]}</div>
                                  <div>{parts.slice(1).join(' ')}</div>
                                </>
                              );
                            })()}
                          </h3>
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
              <RoomsSharedHeader step={step} handleBack={handleBack} title="CHOOSE YOUR ROOM" subtitle="Select your preferred room to continue" />
              
              {loading ? <p className="rooms-loading">Loading room types...</p> : (
                <div className="rooms-list-container">
                  {roomTypes.map(r => {
                    const isAvailable = r.status === 'available';
                    return (
                      <div key={r._id} className="room-selection-card">
                        <div className="room-selection-header">
                          <h3 className="room-selection-name">{r.name}</h3>
                          <div className="room-selection-radio"></div>
                        </div>
                        <div className="room-selection-divider"></div>
                        <div className="room-selection-body">
                          <div className="room-selection-info">
                            <div className="room-selection-label">DESCRIPTION</div>
                            <div className="room-selection-desc">{r.description || "A private room for one person"}</div>
                            <div className="room-selection-label price-label-margin">PRICE</div>
                            <div className="room-selection-price">{Number(r.pricePerNight).toLocaleString()} EGP</div>
                          </div>
                          <div className="room-selection-action">
                            {isAvailable ? (
                              <button className="room-selection-btn" onClick={() => { setSelectedRoom(r); handleNext("guest"); }}>
                                SELECT
                              </button>
                            ) : (
                              <div className="rooms-hotel-badge-na" style={{marginTop:'auto'}}>NOT AVAILABLE</div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {roomTypes.length === 0 && <p className="rooms-empty-msg">No room types available for this hotel.</p>}
                  
                  {roomTypes.length > 0 && (
                    <div className="room-selection-info-card">
                      <div className="room-info-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="12" cy="12" r="11" stroke="#1a56ff" strokeWidth="1.5"/>
                          <path d="M12 7V8M12 11V17" stroke="#1a56ff" strokeWidth="1.5" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <div className="room-info-text">
                        Room preferences are subject to availability.<br/>
                        You can review your selection in the next step.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "guest" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader step={step} handleBack={handleBack} title="ROOM DETAILS" subtitle="Please enter the primary guest details" />
              
              <div className="rooms-details-form-container">
                
                <div className="guest-detail-card">
                  <div className="guest-detail-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  </div>
                  <div className="guest-detail-divider"></div>
                  <div className="guest-detail-content">
                    <label className="guest-detail-label">FULL NAME</label>
                    <input 
                      type="text" 
                      className={`guest-detail-input ${guestDetails.fullName && (!/^[a-zA-Z\s]+$/.test(guestDetails.fullName.replace(/\s+/g, ' ').trim()) || guestDetails.fullName.replace(/\s+/g, ' ').trim().length < 3 || guestDetails.fullName.replace(/\s+/g, ' ').trim().length > 100) ? 'input-error' : ''}`}
                      value={guestDetails.fullName} 
                      onChange={e => setGuestDetails({...guestDetails, fullName: e.target.value.replace(/[^a-zA-Z\s]/g, '')})} 
                      onBlur={() => setGuestDetails({...guestDetails, fullName: guestDetails.fullName.replace(/\s+/g, ' ').trim()})}
                      placeholder="Enter full name" 
                    />
                    {guestDetails.fullName && (!/^[a-zA-Z\s]+$/.test(guestDetails.fullName.replace(/\s+/g, ' ').trim()) || guestDetails.fullName.replace(/\s+/g, ' ').trim().length < 3 || guestDetails.fullName.replace(/\s+/g, ' ').trim().length > 100) && (
                      <span className="guest-detail-error" style={{color: '#ff4444', fontSize: '11px', marginTop: '4px', display: 'block', fontFamily: "'Inter', sans-serif"}}>Please enter a valid full name.</span>
                    )}
                  </div>
                </div>

                <div className="guest-detail-card">
                  <div className="guest-detail-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                  </div>
                  <div className="guest-detail-divider"></div>
                  <div className="guest-detail-content">
                    <label className="guest-detail-label">PHONE NUMBER</label>
                    <input 
                      type="tel" 
                      className={`guest-detail-input ${guestDetails.phoneNumber && !/^01\d{9}$/.test(guestDetails.phoneNumber) ? 'input-error' : ''}`}
                      value={guestDetails.phoneNumber} 
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '');
                        setGuestDetails({...guestDetails, phoneNumber: val.slice(0, 11)});
                      }} 
                      placeholder="01XXXXXXXXX" 
                    />
                    {guestDetails.phoneNumber && !/^01\d{9}$/.test(guestDetails.phoneNumber) && (
                      <span className="guest-detail-error" style={{color: '#ff4444', fontSize: '11px', marginTop: '4px', display: 'block', fontFamily: "'Inter', sans-serif"}}>Please enter a valid Egyptian mobile number.</span>
                    )}
                  </div>
                </div>

                <div className="guest-detail-card">
                  <div className="guest-detail-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div className="guest-detail-divider"></div>
                  <div className="guest-detail-content">
                    <label className="guest-detail-label">NATIONAL ID</label>
                    <input 
                      type="text" 
                      className={`guest-detail-input ${guestDetails.nationalId && guestDetails.nationalId.length !== 14 ? 'input-error' : ''}`}
                      value={guestDetails.nationalId} 
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 14);
                        setGuestDetails({...guestDetails, nationalId: val});
                      }} 
                      placeholder="Enter 14-digit National ID" 
                    />
                    {guestDetails.nationalId && guestDetails.nationalId.length > 0 && guestDetails.nationalId.length !== 14 && (
                      <span className="guest-detail-error">Must be exactly 14 digits</span>
                    )}
                  </div>
                </div>

                <div className="guest-detail-card">
                  <div className="guest-detail-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                  </div>
                  <div className="guest-detail-divider"></div>
                  <div className="guest-detail-content">
                    <label className="guest-detail-label">EMAIL ADDRESS</label>
                    <input type="email" className="guest-detail-input" value={guestDetails.emailAddress} onChange={e => setGuestDetails({...guestDetails, emailAddress: e.target.value})} placeholder="Enter email address" />
                  </div>
                </div>

                <div className="guest-detail-card">
                  <div className="guest-detail-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="4"></line><line x1="8" y1="2" x2="8" y2="4"></line><circle cx="9" cy="11" r="2"></circle><line x1="15" y1="11" x2="17" y2="11"></line><line x1="15" y1="14" x2="17" y2="14"></line><path d="M5 18h8"></path></svg>
                  </div>
                  <div className="guest-detail-divider"></div>
                  <div className="guest-detail-content">
                    <label className="guest-detail-label">NATIONALITY</label>
                    <div className="guest-detail-value">Egyptian</div>
                  </div>
                </div>

                <button 
                  className="guest-next-btn" 
                  disabled={
                    !guestDetails.fullName || 
                    !/^[a-zA-Z\s]+$/.test(guestDetails.fullName.replace(/\s+/g, ' ').trim()) || 
                    guestDetails.fullName.replace(/\s+/g, ' ').trim().length < 3 || 
                    guestDetails.fullName.replace(/\s+/g, ' ').trim().length > 100 ||
                    !guestDetails.phoneNumber || 
                    !/^01\d{9}$/.test(guestDetails.phoneNumber) ||
                    !guestDetails.emailAddress || 
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestDetails.emailAddress) || 
                    guestDetails.nationalId.length !== 14
                  }
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
                      <div className="rooms-instapay-icon">INSTAPAY</div>
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
            <div className="rooms-step-container">
              <RoomsSharedHeader 
                step={step} 
                handleBack={handleBack} 
                title={<span style={{whiteSpace: 'nowrap', fontSize: '20px'}}>UPLOAD PAYMENT PROOF</span>} 
                subtitle={<span style={{fontFamily: "'Inter', sans-serif", letterSpacing: '0'}}>Please upload a clear screenshot<br/>after completing the payment</span>} 
              />
              
              <div className="rooms-upload-card">
                <div 
                  className="rooms-upload-dashed-area"
                  onClick={() => document.getElementById('proof-upload').click()}
                >
                  <svg className="rooms-upload-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 18h11a4 4 0 0 0 0-8h-.5A7 7 0 0 0 5 11.5 4.5 4.5 0 0 0 7 18z"></path>
                    <polyline points="9.5 11.5 12 9 14.5 11.5"></polyline>
                    <line x1="12" y1="9" x2="12" y2="15"></line>
                  </svg>
                  
                  {paymentProof ? (
                    <div className="rooms-file-selected">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                      {paymentProof.name}
                    </div>
                  ) : (
                    <>
                      <div className="rooms-upload-title">TAP TO UPLOAD</div>
                      <div className="rooms-upload-subtitle">or drag and drop your screenshot here</div>
                      <div className="rooms-upload-formats">
                        Accepted formats: JPG, PNG<br/>
                        Max file size: 10MB
                      </div>
                    </>
                  )}

                  <input 
                    type="file" 
                    id="proof-upload"
                    accept="image/png, image/jpeg, image/jpg" 
                    onChange={e => {
                      const file = e.target.files[0];
                      if (file) {
                        if (file.size > 10 * 1024 * 1024) {
                          setError("File size exceeds 10MB. Please choose a smaller image.");
                          setPaymentProof(null);
                        } else {
                          setError("");
                          setPaymentProof(file);
                        }
                      }
                    }}
                    style={{display: 'none'}}
                  />
                </div>
              </div>

              <div className="rooms-info-card">
                <div className="rooms-info-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </div>
                <div className="rooms-info-content">
                  <div className="rooms-info-title">Make sure the screenshot includes:</div>
                  <ul className="rooms-info-list">
                    <li>Payment amount</li>
                    <li>Transaction status</li>
                    <li>Date and time</li>
                    <li>Sender name / mobile number</li>
                  </ul>
                </div>
              </div>

              <button 
                className="rooms-upload-proof-btn" 
                onClick={submitProof}
                disabled={loading || !paymentProof}
              >
                {loading ? "UPLOADING..." : "I HAVE UPLOADED THE PROOF"} <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </button>

              <div className="rooms-secure-badge" style={{marginBottom: '2rem'}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                Your information is secure and encrypted
              </div>
              
            </div>
          )}

          {step === "submitted" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader step={step} handleBack={handleBack} />
              
              <div className="rooms-submitted-illustration">
                <div className="rooms-submitted-glow-circle">
                  <svg className="rooms-submitted-icon" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    <polyline points="9 14 11 16 15 12"></polyline>
                  </svg>
                </div>
              </div>

              <div className="rooms-submitted-header">
                <div className="rooms-submitted-title">THANK YOU!</div>
                <div className="rooms-submitted-subtitle">YOUR PAYMENT PROOF HAS<br/>BEEN RECEIVED</div>
              </div>

              <div className="rooms-submitted-divider"></div>

              <div className="rooms-submitted-desc">
                Your booking request is now under review.<br/>
                You will be notified once your payment<br/>
                has been verified.
              </div>

              <div className="rooms-status-card">
                <div className="rooms-status-header">
                  <div className="rooms-status-label">STATUS</div>
                  <div className="rooms-status-value">UNDER REVIEW</div>
                </div>

                <div className="rooms-status-item" style={{borderTop: '1px solid rgba(255, 255, 255, 0.05)'}}>
                  <div className="rooms-status-icon-container">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  </div>
                  <div className="rooms-status-text">
                    <span className="rooms-status-text-label">Expected verification time</span>
                    <span className="rooms-status-text-value">Within 24 hours</span>
                  </div>
                </div>

                <div className="rooms-status-item">
                  <div className="rooms-status-icon-container">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                  </div>
                  <div className="rooms-status-text">
                    <span className="rooms-status-text-label">We will notify you via</span>
                    <span className="rooms-status-text-value">Email</span>
                  </div>
                </div>
              </div>

              <div className="rooms-info-card" style={{marginBottom: '1rem'}}>
                <div className="rooms-info-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </div>
                <div className="rooms-info-content" style={{paddingTop: '2px'}}>
                  <div className="rooms-info-title" style={{fontWeight: 400, color: 'rgba(255, 255, 255, 0.7)', lineHeight: '1.5'}}>
                    You can track your booking status anytime<br/>from the "My Reservations" page.
                  </div>
                </div>
              </div>

              <button 
                className="rooms-view-reservations-btn" 
                onClick={() => handleNext("my-reservations")}
              >
                VIEW MY RESERVATIONS <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginLeft: '4px'}}><polyline points="9 18 15 12 9 6"></polyline></svg>
              </button>
            </div>
          )}

          {step === "my-reservations" && (
            <div className="rooms-step-container">
              <RoomsSharedHeader 
                step={step} 
                handleBack={handleBack} 
                title={myReservationsList.length === 0 ? "MY RESERVATIONS" : undefined}
                subtitle={myReservationsList.length === 0 ? <span style={{fontFamily: "'Inter', sans-serif", letterSpacing: '0', fontSize: '13px', color: 'rgba(255,255,255,0.7)', textTransform: 'none', lineHeight: '1.5'}}>Enter your phone number to view<br/>your reservations</span> : undefined}
              />

              {myReservationsList.length === 0 ? (
                <>
                  <div style={{width: '100%', marginTop: '1.5rem'}}>
                    <div style={{fontFamily: "'Michroma', sans-serif", fontSize: '11px', color: '#1a56ff', letterSpacing: '0.05em', marginBottom: '1rem', textAlign: 'center'}}>ENTER YOUR PHONE NUMBER</div>
                    <div style={{marginBottom: '1.5rem', background: 'rgba(4, 9, 20, 0.6)', border: '1px solid rgba(26, 86, 255, 0.3)', borderRadius: '8px', padding: '0', display: 'flex', alignItems: 'center', height: '60px', boxShadow: 'inset 0 0 10px rgba(26, 86, 255, 0.05)'}}>
                      <div style={{display: 'flex', alignItems: 'center', padding: '0 1rem', height: '100%', borderRight: '1px solid rgba(255, 255, 255, 0.1)', color: 'white', fontFamily: "'Inter', sans-serif", fontSize: '14px', gap: '4px'}}>
                        +20
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{color: '#1a56ff'}}><polyline points="6 9 12 15 18 9"></polyline></svg>
                      </div>
                      <input 
                        type="tel" 
                        style={{flex: 1, height: '100%', background: 'transparent', border: 'none', color: 'white', fontFamily: "'Inter', sans-serif", fontSize: '15px', padding: '0 1rem', outline: 'none'}} 
                        value={lookupPhone} 
                        onChange={e => setLookupPhone(e.target.value)} 
                        placeholder="Phone number" 
                      />
                    </div>
                    
                    <button className="rooms-upload-proof-btn" onClick={lookupReservations} disabled={loading} style={{width: '100%'}}>
                      {loading ? "SEARCHING..." : "VIEW MY RESERVATIONS"}
                    </button>
                    
                    <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem', color: 'rgba(255, 255, 255, 0.6)', fontFamily: "'Inter', sans-serif", fontSize: '12px'}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                      Your information is secure and encrypted
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="rooms-myres-header">
                    <div className="rooms-myres-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                        <path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path>
                      </svg>
                    </div>
                    <div className="rooms-myres-title-group">
                      <div className="rooms-myres-title">MY RESERVATIONS</div>
                      <div className="rooms-myres-subtitle">View and track all your bookings</div>
                    </div>
                  </div>
                  <div className="rooms-myres-tabs">
                    {["ALL", "UNDER REVIEW", "CONFIRMED"].map(tab => (
                      <div 
                        key={tab} 
                        className={`rooms-myres-tab ${filterTab === tab ? 'active' : ''}`}
                        onClick={() => setFilterTab(tab)}
                      >
                        {tab}
                      </div>
                    ))}
                  </div>

                  <div className="rooms-list">
                    {myReservationsList
                      .filter(res => {
                        const statLower = res.reservationStatus?.toLowerCase() || "pending";
                        const revStatuses = ["pending", "pending_review", "under_verification", "under review", "verification"];
                        
                        if (filterTab === "ALL") return true;
                        if (filterTab === "UNDER REVIEW" && revStatuses.includes(statLower)) return true;
                        if (filterTab === "CONFIRMED" && statLower === "confirmed") return true;
                        if (filterTab === "DECLINED" && statLower === "declined") return true;
                        return false;
                      })
                      .map(res => {
                        const statLower = res.reservationStatus?.toLowerCase() || "pending";
                        const isUnderReview = ["pending", "pending_review", "under_verification", "under review", "verification"].includes(statLower);
                        
                        let statusObj = { class: "under-review", label: "UNDER REVIEW" };
                        if (statLower === "confirmed") {
                          statusObj = { class: "confirmed", label: "CONFIRMED" };
                        } else if (statLower === "declined") {
                          statusObj = { class: "declined", label: "DECLINED" };
                        }
                        
                        const checkInDate = new Date(res.checkInDate).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).toUpperCase();
                        const checkOutDate = new Date(res.checkOutDate).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).toUpperCase();

                        return (
                          <div key={res._id} className="rooms-res-card">
                            <div className="rooms-res-top-row">
                              <div className={`rooms-res-badge ${statusObj.class}`}>
                                {statusObj.label}
                              </div>
                              <div className="rooms-res-id">ID: {res.reservationId}</div>
                            </div>

                            <div className="rooms-res-hotel-row">
                              <div className="rooms-res-hotel-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                                  <path d="M9 22v-4h6v4"></path>
                                  <path d="M8 6h.01"></path><path d="M16 6h.01"></path><path d="M12 6h.01"></path>
                                  <path d="M12 10h.01"></path><path d="M12 14h.01"></path>
                                  <path d="M16 10h.01"></path><path d="M16 14h.01"></path>
                                  <path d="M8 10h.01"></path><path d="M8 14h.01"></path>
                                </svg>
                              </div>
                              <div className="rooms-res-hotel-info">
                                <div className="rooms-res-hotel-name">{res.hotelId?.name || "HOTEL NAME"}</div>
                                <div className="rooms-res-room-type">{res.roomTypeId?.name || "Room"} • {res.roomTypeId?.breakfastIncluded ? "With Breakfast" : "No Breakfast"}</div>
                              </div>
                            </div>

                            <div className="rooms-res-stay-grid">
                              <div className="rooms-res-stay-item">
                                <svg className="rooms-res-stay-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                <div className="rooms-res-stay-text">
                                  <span className="rooms-res-stay-value">{checkInDate}</span>
                                  <span className="rooms-res-stay-label">Check-in</span>
                                </div>
                              </div>
                              <div className="rooms-res-stay-item">
                                <svg className="rooms-res-stay-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                                <div className="rooms-res-stay-text">
                                  <span className="rooms-res-stay-value">{checkOutDate}</span>
                                  <span className="rooms-res-stay-label">Check-out</span>
                                </div>
                              </div>
                              <div className="rooms-res-stay-item">
                                <svg className="rooms-res-stay-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                                <div className="rooms-res-stay-text">
                                  <span className="rooms-res-stay-value">{res.stayDuration} NIGHTS</span>
                                  <span className="rooms-res-stay-label">Stay Duration</span>
                                </div>
                              </div>
                            </div>

                            <div className="rooms-res-bottom-row">
                              <div className="rooms-res-total-col">
                                <span className="rooms-res-total-label">TOTAL AMOUNT</span>
                                <span className="rooms-res-total-value">{res.totalAmount?.toLocaleString()} EGP</span>
                              </div>
                              <button 
                                className="rooms-res-view-btn"
                                onClick={() => { setReservation(res); handleNext("reservation-details"); }}
                              >
                                VIEW DETAILS <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    {myReservationsList.filter(res => {
                        const statLower = res.reservationStatus?.toLowerCase() || "pending";
                        const revStatuses = ["pending", "pending_review", "under_verification", "under review", "verification"];
                        if (filterTab === "ALL") return true;
                        if (filterTab === "UNDER REVIEW" && revStatuses.includes(statLower)) return true;
                        if (filterTab === "CONFIRMED" && statLower === "confirmed") return true;
                        if (filterTab === "DECLINED" && statLower === "declined") return true;
                        return false;
                    }).length === 0 && (
                      <div style={{textAlign: 'center', color: 'rgba(255,255,255,0.5)', padding: '2rem 0'}}>
                        No reservations found for {filterTab}.
                      </div>
                    )}
                    

                  </div>
                </>
              )}
            </div>
          )}

          {step === "reservation-details" && reservation && (() => {
            const statusMap = {
              "pending": { class: "pending", label: "UNDER REVIEW", desc: "Your payment proof is under review.", icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><circle cx="12" cy="14" r="3"></circle><polyline points="12 13 12 14 13 15"></polyline></svg> },
              "confirmed": { class: "confirmed", label: "CONFIRMED", desc: "Your reservation is confirmed.", icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><polyline points="9 14 11 16 15 12"></polyline></svg> },
              "declined": { class: "declined", label: "DECLINED", desc: "Your reservation was declined.", icon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><line x1="9" y1="11" x2="15" y2="17"></line><line x1="15" y1="11" x2="9" y2="17"></line></svg> }
            };
            const statusObj = statusMap[reservation.reservationStatus] || statusMap["pending"];
            
            const checkInDate = new Date(reservation.checkInDate);
            const checkOutDate = new Date(reservation.checkOutDate);
            
            const formatRoomName = (name) => {
              if (!name) return "ROOM";
              const upper = name.toUpperCase();
              if (upper.includes("DOUBLE")) return "Double Room";
              if (upper.includes("SINGLE")) return "Single Room";
              if (upper.includes("TRIPLE")) return "Triple Room";
              return name;
            };

            return (
              <div className="rooms-step-container" style={{ maxWidth: '500px' }}>
                <RoomsSharedHeader step="my-reservations" handleBack={handleBack} />

                <div className="rooms-myres-header">
                  <div className="rooms-myres-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                      <path d="M9 16l2 2 4-4"></path>
                    </svg>
                  </div>
                  <div className="rooms-myres-title-group">
                    <div className="rooms-myres-title">RESERVATION DETAILS</div>
                    <div className="rooms-myres-subtitle">View your booking information</div>
                  </div>
                </div>

                <div className={`rooms-rd-status-card ${statusObj.class}`}>
                  <div className="rooms-rd-status-info">
                    <div className="rooms-rd-status-label">STATUS</div>
                    <div className="rooms-rd-status-value">{statusObj.label}</div>
                    <div className="rooms-rd-status-desc">{statusObj.desc}</div>
                  </div>
                  <div className="rooms-rd-status-icon-box">
                    {statusObj.icon}
                  </div>
                </div>

                <div className="rooms-rd-id-card">
                  <div className="rooms-rd-id-label">RESERVATION ID</div>
                  <div className="rooms-rd-id-value">
                    {reservation.reservationId}
                    <svg className="rooms-rd-id-copy" onClick={() => navigator.clipboard.writeText(reservation.reservationId)} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  </div>
                </div>

                <div className="rooms-rd-section-card">
                  <div className="rooms-rd-section-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><path d="M9 22v-4h6v4"></path><path d="M8 6h.01"></path><path d="M16 6h.01"></path><path d="M12 6h.01"></path><path d="M12 10h.01"></path><path d="M12 14h.01"></path><path d="M16 10h.01"></path><path d="M16 14h.01"></path><path d="M8 10h.01"></path><path d="M8 14h.01"></path></svg>
                  </div>
                  <div className="rooms-rd-section-content" style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="rooms-rd-field" style={{ flex: 1, minWidth: 0 }}>
                      <div className="rooms-rd-label">HOTEL</div>
                      <div className="rooms-rd-value" style={{ fontSize: '0.6rem', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.4' }}>{reservation.hotelId?.name}</div>
                      <div className="rooms-rd-stars">
                        <svg className="rooms-rd-star" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        <svg className="rooms-rd-star" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        <svg className="rooms-rd-star" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        <svg className="rooms-rd-star" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                        <svg className="rooms-rd-star" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                      </div>
                    </div>
                    <div style={{ width: '1px', height: '36px', background: 'rgba(255,255,255,0.1)', margin: '0 1rem' }}></div>
                    <div className="rooms-rd-field" style={{ flex: 1, minWidth: 0 }}>
                      <div className="rooms-rd-label">ROOM TYPE</div>
                      <div className="rooms-rd-value" style={{ fontSize: '0.6rem', fontFamily: "'Inter', sans-serif" }}>{formatRoomName(reservation.roomTypeId?.name)}</div>
                      <div className="rooms-rd-subvalue">{reservation.roomTypeId?.breakfastIncluded ? "With Breakfast" : "No Breakfast"}</div>
                    </div>
                  </div>
                </div>

                <div className="rooms-rd-section-card">
                  <div className="rooms-rd-section-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                  </div>
                  <div className="rooms-rd-section-content">
                    <div className="rooms-rd-label" style={{marginBottom: '1rem'}}>STAY DATES</div>
                    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div className="rooms-rd-field" style={{ flex: 1, minWidth: 0 }}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>CHECK-IN</div>
                        <div className="rooms-rd-value" style={{ fontSize: '0.55rem' }}>{checkInDate.toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).toUpperCase()}</div>
                        <div className="rooms-rd-subvalue" style={{ fontSize: '0.5rem' }}>{checkInDate.toLocaleDateString('en-GB', {weekday: 'long'})}</div>
                      </div>
                      <div style={{ width: '1px', height: '36px', background: 'rgba(255,255,255,0.1)', alignSelf: 'center' }}></div>
                      <div className="rooms-rd-field" style={{ flex: 1, minWidth: 0, paddingLeft: '0.5rem' }}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>CHECK-OUT</div>
                        <div className="rooms-rd-value" style={{ fontSize: '0.55rem' }}>{checkOutDate.toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).toUpperCase()}</div>
                        <div className="rooms-rd-subvalue" style={{ fontSize: '0.5rem' }}>{checkOutDate.toLocaleDateString('en-GB', {weekday: 'long'})}</div>
                      </div>
                      <div style={{ width: '1px', height: '36px', background: 'rgba(255,255,255,0.1)', alignSelf: 'center' }}></div>
                      <div className="rooms-rd-field" style={{ flex: 1, minWidth: 0, paddingLeft: '0.5rem' }}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>STAY DURATION</div>
                        <div className="rooms-rd-value" style={{ fontSize: '0.55rem' }}>{reservation.stayDuration} NIGHTS</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rooms-rd-section-card">
                  <div className="rooms-rd-section-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  </div>
                  <div className="rooms-rd-section-content">
                    <div className="rooms-rd-label" style={{marginBottom: '1rem'}}>GUEST DETAILS</div>
                    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '1rem' }}>
                      <div className="rooms-rd-field" style={{ flex: 1, minWidth: 0 }}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>FULL NAME</div>
                        <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.55rem', fontWeight: 400}}>{reservation.fullName}</div>
                      </div>
                      <div className="rooms-rd-field" style={{ flex: 1.2, minWidth: 0 }}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>PHONE NUMBER</div>
                        <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.55rem', fontWeight: 400}}>{reservation.phoneNumber}</div>
                      </div>
                      <div className="rooms-rd-field" style={{ flex: 1.5, minWidth: 0 }}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>EMAIL ADDRESS</div>
                        <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.55rem', fontWeight: 400, whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: '1.4'}}>{reservation.emailAddress}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'flex-start', gap: '0.5rem' }}>
                      <div className="rooms-rd-field" style={{ width: '30%' }}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>NATIONALITY</div>
                        <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.55rem', fontWeight: 400}}>{reservation.nationality || "Egyptian"}</div>
                      </div>
                      {reservation.nationalId && (
                        <div className="rooms-rd-field" style={{ width: '30%' }}>
                          <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>NATIONAL ID</div>
                          <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.55rem', fontWeight: 400}}>{reservation.nationalId}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rooms-rd-section-card">
                  <div className="rooms-rd-section-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
                  </div>
                  <div className="rooms-rd-section-content">
                    <div className="rooms-rd-label" style={{marginBottom: '1rem'}}>PRICE SUMMARY</div>
                    
                    <div className="rooms-rd-price-row" style={{marginBottom: '0.4rem'}}>
                      <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>PRICE PER NIGHT</div>
                      <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.6rem', fontWeight: 500}}>{(reservation.totalAmount / reservation.stayDuration).toLocaleString()} EGP</div>
                    </div>
                    <div className="rooms-rd-price-row" style={{marginBottom: '0.4rem'}}>
                      <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>NIGHTS</div>
                      <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.6rem', fontWeight: 500}}>{reservation.stayDuration}</div>
                    </div>
                    
                    <div className="rooms-rd-price-divider" style={{margin: '0.8rem 0'}}></div>
                    
                    <div className="rooms-rd-price-row" style={{marginBottom: 0}}>
                      <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>TOTAL AMOUNT</div>
                      <div className="rooms-rd-total-amount" style={{fontSize: '0.8rem'}}>{reservation.totalAmount?.toLocaleString()} EGP</div>
                    </div>
                  </div>
                </div>

                <div className="rooms-rd-section-card">
                  <div className="rooms-rd-section-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                  </div>
                  <div className="rooms-rd-section-content">
                    <div className="rooms-rd-label" style={{marginBottom: '1rem'}}>PAYMENT STATUS</div>
                    <div style={{ display: 'flex', flexDirection: 'row', gap: '1.5rem' }}>
                      <div className="rooms-rd-field" style={{flex: 1, minWidth: 0}}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>PAYMENT METHOD</div>
                        <div className="rooms-rd-value" style={{fontFamily: "'Inter', sans-serif", fontSize: '0.55rem'}}>Instapay</div>
                      </div>
                      <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }}></div>
                      <div className="rooms-rd-field" style={{flex: 1.5, minWidth: 0}}>
                        <div className="rooms-rd-label" style={{ fontSize: '0.45rem' }}>PAYMENT PROOF</div>
                        <div className="rooms-rd-proof-status" style={{fontSize: '0.55rem'}}>
                          Uploaded <svg className="rooms-rd-proof-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                        </div>
                        <div className="rooms-rd-label" style={{marginTop: '0.6rem', fontSize: '0.45rem'}}>SUBMITTED ON</div>
                        <div className="rooms-rd-subvalue" style={{marginTop: 0, fontSize: '0.5rem'}}>{new Date(reservation.createdAt || reservation.checkInDate).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).toUpperCase()} • {new Date(reservation.createdAt || reservation.checkInDate).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit'})}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rooms-rd-info-card">
                  <div className="rooms-rd-info-icon">i</div>
                  <div className="rooms-rd-info-text">
                    You will receive a confirmation once<br/>your payment has been verified.
                  </div>
                </div>

                <button 
                  className="rooms-rd-back-btn" 
                  onClick={() => handleBack("my-reservations")}
                >
                  BACK TO MY RESERVATIONS
                </button>
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
