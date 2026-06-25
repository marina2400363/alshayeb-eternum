const fs = require('fs');

let appJs = fs.readFileSync('src/App.js', 'utf8');

const startIndex = appJs.indexOf('  return (\n    <main className="eternum-home">');
const endIndex = appJs.indexOf('    </main>\n  );\n}\n\nfunction isAdminAuthenticated() {');

if (startIndex === -1 || endIndex === -1) {
  console.error("Could not find the Home block in App.js");
  process.exit(1);
}

const newHomeJSX = `  return (
    <main className="eternum-home-portal">
      {/* Background Image Overlay */}
      <div className="home-portal-bg">
        <div className="home-portal-overlay"></div>
      </div>

      <div className="home-portal-content">
        {/* Brand Header */}
        <div className="home-portal-header">
          <h1 className="home-portal-title">ALSHAYEB</h1>
          <h2 className="home-portal-subtitle">EXPERIENCE</h2>
          <p className="home-portal-tagline">NO BEGINNING. NO END.</p>
        </div>

        {/* Section Label */}
        <div className="home-portal-section-label">
          <div className="portal-diamond-line" />
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 0.5L9.5 5L5 9.5L0.5 5Z" stroke="rgba(127,157,255,0.6)" strokeWidth="1" fill="none"/>
          </svg>
          <span>CHOOSE YOUR PATH</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M5 0.5L9.5 5L5 9.5L0.5 5Z" stroke="rgba(127,157,255,0.6)" strokeWidth="1" fill="none"/>
          </svg>
          <div className="portal-diamond-line" />
        </div>

        {/* Path Cards */}
        <div className="home-portal-cards">
          
          <button className="portal-card" onClick={() => setPage('incomer')}>
            <div className="portal-card-number">01</div>
            <div className="portal-card-text">
              <span className="portal-card-kicker">THE INVITED</span>
              <span className="portal-card-name">INCOMER</span>
              <span className="portal-card-desc">Already invited? Access your digital pass and event details.</span>
            </div>
            <div className="portal-card-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </div>
          </button>

          <button className="portal-card" onClick={() => setPage('outcomerLanding')}>
            <div className="portal-card-number">02</div>
            <div className="portal-card-text">
              <span className="portal-card-kicker">THE SEEKERS</span>
              <span className="portal-card-name">OUTCOMER</span>
              <span className="portal-card-desc">Request access to join the experience. Applications are reviewed by alshayeb's team.</span>
            </div>
            <div className="portal-card-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </div>
          </button>

          <button className="portal-card" onClick={() => setPage('guestList')}>
            <div className="portal-card-number">03</div>
            <div className="portal-card-text">
              <span className="portal-card-kicker">THE ETERNAL LIST</span>
              <span className="portal-card-name">GUEST LIST</span>
              <span className="portal-card-desc">Check if your name made it onto the Eternal List.</span>
            </div>
            <div className="portal-card-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"></line>
                <polyline points="12 5 19 12 12 19"></polyline>
              </svg>
            </div>
          </button>

        </div>

        {/* Footer */}
        <footer className="home-portal-footer">
          <p>YOUR JOURNEY. SECURE. PRIVATE. ETERNAL.</p>
          <p className="home-portal-footer-brand">&bull; ALSHAYEB EXPERIENCE &bull;</p>
        </footer>
      </div>
`;

const newAppJs = appJs.slice(0, startIndex) + newHomeJSX + appJs.slice(endIndex);
fs.writeFileSync('src/App.js', newAppJs);
console.log("Successfully replaced Home JSX in App.js");
