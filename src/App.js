import React, { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import "./App.css";

function App() {
  const [phone, setPhone] = useState("");
  const [clients, setClients] = useState([]);
  const [foundClient, setFoundClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState("home");

  const API_URL =
    "https://script.google.com/macros/s/AKfycbxg8nRm1dds5DDZRWqdIOmoo2fCD-XR__cgV13-m1m9GUacdpDRTG8MKrw6f3CKwxMJAA/exec";

  const cleanValue = (value) => {
    return String(value || "").replace(/\s/g, "").replace(/'/g, "").trim();
  };

  useEffect(() => {
    fetch(API_URL + "?t=" + new Date().getTime())
      .then((res) => res.json())
      .then((data) => {
        setClients(data);
        setLoading(false);
      })
      .catch((error) => {
        console.log("Error:", error);
        setLoading(false);
      });
  }, []);

  const handleSearch = () => {
    const typedPhone = cleanValue(phone);

    const client = clients.find(
      (c) => cleanValue(c.phone) === typedPhone
    );

    if (client) {
      setFoundClient(client);
      setPage("ticket");
    } else {
      setFoundClient("notfound");
    }
  };

  if (page === "ticket" && foundClient && foundClient !== "notfound") {
    const status = String(foundClient.status || "not used").toLowerCase();

    return (
      <div className="ticket-page">
        <div className="ticket-card">
          <div className="left-side">
            <div className="circle"></div>

            <h3>ALSHAYEB</h3>
            <h1>ETERNUM</h1>
            <p className="tagline">NO BEGINNING. NO END.</p>

            <div className="welcome">
              <h2>WELCOME, {foundClient.name}</h2>
              <p>
                A space beyond time.<br />
                Where music connects us.<br />
                Where moments become eternity.
              </p>
            </div>

            <div className="qr-section">
              <h2>YOUR QR CODE</h2>

              <div className="qr-white">
                <QRCode value={foundClient.qr} size={230} />
              </div>

              <p>{foundClient.qr}</p>

              <div className={status === "used" ? "status used" : "status not-used"}>
                STATUS: {status === "used" ? "USED BEFORE" : "NOT USED"}
              </div>
            </div>

            <div className="user-info-card">
              <h2>USER DETAILS</h2>

              <div className="user-row">
                <span>Name</span>
                <p>{foundClient.name}</p>
              </div>

              <div className="user-row">
                <span>Phone</span>
                <p>{foundClient.phone}</p>
              </div>

              <div className="user-row">
                <span>Access Type</span>
                <p>{foundClient.accessType}</p>
              </div>

              <div className="user-row">
                <span>QR ID</span>
                <p>{foundClient.qr}</p>
              </div>

              <div className="user-row">
                <span>Status</span>
                <p>{status === "used" ? "USED BEFORE" : "NOT USED"}</p>
              </div>
            </div>
          </div>

          <div className="right-side">
            <h2>ABOUT THE VENUE</h2>
            <p>
              ALSHAYEB ETERNUM is our iconic destination for music, art
              and connection. Designed to create unforgettable experiences
              in a unique circular space where energy flows endlessly.
            </p>

            <div className="info-list">
              <div><span>CAPACITY</span><p>10,000+</p></div>
              <div><span>360° EXPERIENCE</span><p>Immersive sound & light</p></div>
              <div><span>WORLD CLASS SOUND</span><p>Next level audio system</p></div>
              <div><span>SAFETY FIRST</span><p>Security & crowd management</p></div>
              <div><span>PREMIUM EXPERIENCE</span><p>VIP areas, bars, exclusive service</p></div>
            </div>

            <div className="menu-box">UPCOMING EVENTS ›</div>
            <div className="menu-box">TICKETS ›</div>
            <div className="menu-box">LOCATION ›</div>
            <div className="menu-box">INSTAGRAM ›</div>
            <div className="menu-box">WHATSAPP ›</div>

            <button className="back-btn" onClick={() => setPage("home")}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>ALSHAYEB QR ACCESS</h1>

      {loading && <p>Loading guest list...</p>}

      <input
        type="text"
        placeholder="Enter your phone number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <button onClick={handleSearch} disabled={loading}>
        Get QR Code
      </button>

      {foundClient === "notfound" && (
        <p className="error">Phone number not found</p>
      )}
    </div>
  );
}

export default App;