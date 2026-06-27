const fs = require('fs');

let c = fs.readFileSync('src/RoomsApp.js', 'utf8');

c = c.replace(/const RoomsSharedHeader =[^]*?export default function RoomsApp/, `const RoomsSharedHeader = ({ step, handleBack, title, subtitle }) => {
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
              <div className={\`rooms-progress-step \${isActive ? 'active' : ''}\`} key={s.num}>
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

export default function RoomsApp`);

fs.writeFileSync('src/RoomsApp.js', c);
