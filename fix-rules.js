const fs = require("fs");
let app = fs.readFileSync("src/App.js", "utf8");

const newRules = `  if (page === "houseRules") {
    return (
      <div className="incomer-page-container rules-page-container">
        {/* BACK ARROW */}
        <div className="incomer-back-wrapper">
          <button
            onClick={() => setPage("home")}
            aria-label="Go back"
            className="incomer-back-btn"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
        </div>

        <div className="rules-header">
          <div className="rules-brand-logo">ALSHAYEB</div>
          <h1 className="rules-title">HOUSE RULES</h1>
          <p className="rules-subtitle">
            <span className="rules-cyan">READ BEFORE YOU ENTER.</span><br/>
            Every destination has rules.<br/>
            These aren't restrictions. They're what protect the experience.
          </p>
        </div>

        <div className="rules-list">
          <div className="rule-card">
            <div className="rule-num">01</div>
            <div className="rule-content">
              <h3>ENTRY</h3>
              <p>&#8226; Your QR code is personal. Sharing or transferring it ends your access.</p>
              <p>&#8226; ALSHAYEB team may request a valid ID for verification</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">02</div>
            <div className="rule-content">
              <h3>DOORS</h3>
              <p>&#8226; Doors open at 9:00 PM and close at 10:00 PM.</p>
              <p>&#8226; Arrive early. Great experiences don't wait for late arrivals.</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">03</div>
            <div className="rule-content">
              <h3>RE-ENTRY</h3>
              <p>&#8226; Re-entry is permitted only for guests wearing their official ALSHAYEB wristband.</p>
              <p>&#8226; Lost, removed, or damaged wristbands will void re-entry access.</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">04</div>
            <div className="rule-content">
              <h3>QR VALIDATION</h3>
              <p>Only QR codes accessed through the official ALSHAYEB website are accepted. Screenshots, copies, or duplicated QR codes are invalid.<br/>
              For security, your QR code will remain locked and automatically unlock only when you are near the venue entrance.</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">05</div>
            <div className="rule-content">
              <h3>SECURITY</h3>
              <p>&#8226; All guests are subject to security screening before entry.</p>
              <p>&#8226; Weapons, illegal items, laser devices, drones, professional cameras, and unauthorized recording equipment never make it inside.</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">06</div>
            <div className="rule-content">
              <h3>ALCOHOL &amp; DRUGS</h3>
              <p>&#8226; Illegal drugs and prohibited substances have no place here.</p>
              <p>&#8226; Alcohol is available only at events where ALSHAYEB officially permits it.</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">07</div>
            <div className="rule-content">
              <h3>RESPECT</h3>
              <p>&#8226; Respect isn't optional. It's the minimum requirement to stay.</p>
              <p>&#8226; Harassment, unwanted physical contact, violence, discrimination, or disruptive behavior ends your experience immediately.</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">08</div>
            <div className="rule-content">
              <h3>MEDIA</h3>
              <p>&#8226; Some moments deserve to be remembered.</p>
              <p>&#8226; By attending, you agree that photos and videos featuring you may be used by ALSHAYEB's media team</p>
            </div>
          </div>
          <div className="rule-card">
            <div className="rule-num">09</div>
            <div className="rule-content">
              <h3>RIGHT OF ADMISSION</h3>
              <p>&#8226; ALSHAYEB reserves the right to refuse entry or remove any guest to protect the experience and the safety of others.</p>
            </div>
          </div>
        </div>

        <div className="rules-footer">
          <div className="rules-footer-title">FINAL NOTICE</div>
          <div className="rules-footer-text">
            <span>PROTECT THE EXPERIENCE.</span>
            <span className="rules-divider">|</span>
            <span>RESPECT EVERYONE.</span>
            <span className="rules-divider">|</span>
            <span className="rules-cyan">ALSHAYEB ETERNUM.</span>
          </div>
        </div>
      </div>
    );
  }`;

app = app.replace(/  if \(page === "houseRules"\) \{[\s\S]*?  if \(page === "guestList"\) \{/, newRules + "\n\n  if (page === \"guestList\") {");

fs.writeFileSync("src/App.js", app, "utf8");
console.log("App.js updated");

