const fs = require('fs');

let content = fs.readFileSync('src/RoomsApp.js', 'utf8');

// 1. Remove eternum-header
content = content.replace(
`      {step !== "home" && (
        <div className="eternum-header">
          <div className="eternum-logo-container">
            <img src="/logo.svg" alt="ALSHAYEB ETERNUM Logo" className="eternum-logo-icon" />
            <div className="eternum-wordmark">ALSHAYEB<br/>EXPERIENCE</div>
          </div>
        </div>
      )}`,
""
);

// 2. Define RoomsSharedHeader component
const headerComponent = `
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
`;

// Insert the component after imports (before App component)
if (!content.includes('RoomsSharedHeader')) {
  content = content.replace('export default function RoomsApp() {', headerComponent + '\nexport default function RoomsApp() {');
}

// 3. Patch hotels step
const hotelsPattern = /<div className="rooms-top-nav">[\s\S]*?<div className="rooms-step-header">[\s\S]*?<\/div>/m;
content = content.replace(hotelsPattern, '<RoomsSharedHeader step={step} handleBack={handleBack} title="CHOOSE YOUR HOTEL" subtitle="Select your preferred hotel to continue" />');

// Remove bottom spade from hotels
content = content.replace(/<div className="rooms-bottom-spade">[\s\S]*?<\/div>/, '');

// 4. Patch dates step
const datesPattern = /<div className="rooms-step">\s*<button className="rooms-back-button"[^>]*>← Back<\/button>\s*<h2 className="rooms-step-title">Choose Dates<\/h2>/;
content = content.replace(datesPattern, '<div className="rooms-step-container">\n              <RoomsSharedHeader step={step} handleBack={handleBack} title="CHOOSE DATES" subtitle="Select your check-in and check-out dates" />');

// 5. Patch rooms step
const roomsPattern = /<div className="rooms-step">\s*<button className="rooms-back-button"[^>]*>← Back<\/button>\s*<h2 className="rooms-step-title">Choose Room Type<\/h2>/;
content = content.replace(roomsPattern, '<div className="rooms-step-container">\n              <RoomsSharedHeader step={step} handleBack={handleBack} title="CHOOSE ROOM" subtitle="Select your preferred room type" />');

// 6. Patch guest step
const guestPattern = /<div className="rooms-step">\s*<button className="rooms-back-button"[^>]*>← Back<\/button>\s*<h2 className="rooms-step-title">Guest Details<\/h2>/;
content = content.replace(guestPattern, '<div className="rooms-step-container">\n              <RoomsSharedHeader step={step} handleBack={handleBack} title="GUEST DETAILS" subtitle="Provide your reservation details" />');

// 7. Patch payment step
const paymentPattern = /<div className="rooms-step">\s*<button className="rooms-back-button"[^>]*>← Back<\/button>\s*<h2 className="rooms-step-title">Payment & Summary<\/h2>/;
content = content.replace(paymentPattern, '<div className="rooms-step-container">\n              <RoomsSharedHeader step={step} handleBack={handleBack} title="PAYMENT SUMMARY" subtitle="Review and confirm your reservation" />');

// Need to also close the dates, rooms, guest, payment div tags if I replaced "rooms-step" with "rooms-step-container", which is the same closing tag `</div>`, so it's fine.

fs.writeFileSync('src/RoomsApp.js', content);
console.log('Done!');
