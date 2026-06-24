const fs = require('fs');
let code = fs.readFileSync('src/App.js', 'utf8');

// 1. Add eternum-page-bg to public wrappers
code = code.replace(/className="incomer-page-container"/g, 'className="incomer-page-container eternum-page-bg"');
code = code.replace(/className="outcomer-landing-container"/g, 'className="outcomer-landing-container eternum-page-bg"');
code = code.replace(/className="outcomer-landing-container outcomer-destinations-container"/g, 'className="outcomer-landing-container outcomer-destinations-container eternum-page-bg"');
code = code.replace(/className="outcomer-landing-container outcomer-register-container"/g, 'className="outcomer-landing-container outcomer-register-container eternum-page-bg"');
code = code.replace(/className="pay-page"/g, 'className="pay-page eternum-page-bg"');
code = code.replace(/className="upv-page"/g, 'className="upv-page eternum-page-bg"');
code = code.replace(/className="sub-page"/g, 'className="sub-page eternum-page-bg"');
code = code.replace(/className="track-page"/g, 'className="track-page eternum-page-bg"');
code = code.replace(/className="ticket-page"/g, 'className="ticket-page eternum-page-bg"');
code = code.replace(/className="outcomer-landing-container arp-page"/g, 'className="outcomer-landing-container arp-page eternum-page-bg"');
code = code.replace(/className="incomer-page-container guest-list-reference"/g, 'className="incomer-page-container guest-list-reference eternum-page-bg"');

// Payment public page has its own class on PublicShell
code = code.replace(/className="payment-public-page"/g, 'className="payment-public-page eternum-page-bg"');

// 2. Buttons
// Let's replace purple-btn with purple-btn eternum-button on public pages.
// I will just use regex to target the button elements but it's safer to target exact text.

// "TRACK STATUS" button
code = code.replace(/<button className="purple-btn" onClick=\{\(\) => setPage\("trackLookup"\)\}>/g, '<button className="purple-btn eternum-button" onClick={() => setPage("trackLookup")}>');

// "REGISTER AS OUTCOMER" button
code = code.replace(/<button className="purple-btn" onClick=\{\(\) => setPage\("outcomerLanding"\)\}>/g, '<button className="purple-btn eternum-button" onClick={() => setPage("outcomerLanding")}>');

// "INCOMER \(ALSHAYEB\)" button
code = code.replace(/<button className="purple-btn" onClick=\{\(\) => setPage\("incomer"\)\}>/g, '<button className="purple-btn eternum-button" onClick={() => setPage("incomer")}>');

// "ALSHAYEB GUEST LIST" button
code = code.replace(/<button className="purple-btn" onClick=\{\(\) => setPage\("guestList"\)\}>/g, '<button className="purple-btn eternum-button" onClick={() => setPage("guestList")}>');

// Track Lookup submit
code = code.replace(/<button className="purple-btn" disabled=\{loading\} onClick=\{handleLookupSubmit\}>/g, '<button className="purple-btn eternum-button" disabled={loading} onClick={handleLookupSubmit}>');

// "CHOOSE EVENT" button
code = code.replace(/<button className="purple-btn" disabled=\{loading\} onClick=\{handleTrackLookup\}>/g, '<button className="purple-btn eternum-button" disabled={loading} onClick={handleTrackLookup}>');

// Event selection buttons (map over liveEvents)
code = code.replace(/<button className="purple-btn event-select-btn"/g, '<button className="purple-btn event-select-btn eternum-button"');

// "PROCEED TO PAYMENT"
code = code.replace(/<button className="purple-btn pay-btn" disabled=\{isSubmitting\} onClick=\{goToPayment\}>/g, '<button className="purple-btn pay-btn eternum-button" disabled={isSubmitting} onClick={goToPayment}>');

// "SUBMIT PAYMENT PROOF"
code = code.replace(/<button className="purple-btn" disabled=\{isSubmitting\} onClick=\{submitRequest\}>/g, '<button className="purple-btn eternum-button" disabled={isSubmitting} onClick={submitRequest}>');

// "BACK TO HOME" in submitted
code = code.replace(/<button className="purple-btn" onClick=\{\(\) => window\.location\.reload\(\)\}>/g, '<button className="purple-btn eternum-button" onClick={() => window.location.reload()}>');

// "RETRY SUBMISSION" in rejected
code = code.replace(/<button className="purple-btn" onClick=\{\(\) => setPage\("payment"\)\}>/g, '<button className="purple-btn eternum-button" onClick={() => setPage("payment")}>');

// Instapay link button
code = code.replace(/<a href=\{instapayLink\} target="_blank" rel="noopener noreferrer" className="purple-btn pay-link-btn">/g, '<a href={instapayLink} target="_blank" rel="noopener noreferrer" className="purple-btn pay-link-btn eternum-button">');
code = code.replace(/<button className="ghost-btn" onClick=\{\(\) => setPage\("upload"\)\}>/g, '<button className="ghost-btn eternum-button" onClick={() => setPage("upload")}>');

// ARP login button
code = code.replace(/<button className="purple-btn" onClick=\{handleLogin\}>/g, '<button className="purple-btn eternum-button" onClick={handleLogin}>');

// Home Search Incomer
code = code.replace(/<button className="purple-btn" disabled=\{loading\} onClick=\{handleSearch\}>/g, '<button className="purple-btn eternum-button" disabled={loading} onClick={handleSearch}>');

// NOTFOUND Page "PROCEED AS OUTCOMER"
code = code.replace(/<button className="purple-btn" onClick=\{\(\) => setPage\("outcomerLanding"\)\}>/g, '<button className="purple-btn eternum-button" onClick={() => setPage("outcomerLanding")}>');
code = code.replace(/<button className="ghost-btn" onClick=\{\(\) => setPage\("home"\)\}>/g, '<button className="ghost-btn eternum-button" onClick={() => setPage("home")}>');

// Home page ticket button?
code = code.replace(/<button className="purple-btn track-btn" onClick=\{\(\) => setPage\("trackLookup"\)\}>/g, '<button className="purple-btn track-btn eternum-button" onClick={() => setPage("trackLookup")}>');
code = code.replace(/<button className="purple-btn find-btn" disabled=\{loading\} onClick=\{handleSearch\}>/g, '<button className="purple-btn find-btn eternum-button" disabled={loading} onClick={handleSearch}>');

// "PrimaryButton" in App.js uses eternum-button
code = code.replace(/className={`eternum-button/g, 'className={`eternum-button');


// 3. Inputs (Public Only)
// I will explicitly target inputs by their placeholder or surrounding tags.

code = code.replace(/<input name="fullName" placeholder="Enter your full name"/g, '<input className="eternum-input" name="fullName" placeholder="Enter your full name"');
code = code.replace(/<input name="phoneNumber" placeholder="Enter your phone number"/g, '<input className="eternum-input" name="phoneNumber" placeholder="Enter your phone number"');
code = code.replace(/<input name="email" placeholder="Enter your email address"/g, '<input className="eternum-input" name="email" placeholder="Enter your email address"');
code = code.replace(/<input\n\s*name="schoolOrOriginProm"\n\s*placeholder="Select"/g, '<input className="eternum-input"\n                    name="schoolOrOriginProm"\n                    placeholder="Select"');
code = code.replace(/<input name="age" placeholder="Enter your age"/g, '<input className="eternum-input" name="age" placeholder="Enter your age"');
code = code.replace(/<input name="instagramUsername" placeholder="Enter your Instagram username"/g, '<input className="eternum-input" name="instagramUsername" placeholder="Enter your Instagram username"');
code = code.replace(/<input\n\s*className="arp-phone-input"\n\s*type="tel"/g, '<input\n                className="arp-phone-input eternum-input"\n                type="tel"');

// <input type="tel" placeholder="Enter your phone number"
code = code.replace(/<input\n\s*type="tel"\n\s*placeholder="Enter your phone number"/g, '<input className="eternum-input"\n                type="tel"\n                placeholder="Enter your phone number"');

// PhoneInput component 
code = code.replace(/<input type="text" placeholder="Enter your phone number" value=\{value\}/g, '<input className="eternum-input" type="text" placeholder="Enter your phone number" value={value}');


// File uploads
code = code.replace(/<label className="upload-box">/g, '<label className="upload-box eternum-input">');


fs.writeFileSync('src/App.js', code);
console.log('Refactor complete!');
