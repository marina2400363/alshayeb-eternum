const fs = require('fs');

// 1. Fix App.js structure for Gender, Select, and Upload rows.
let js = fs.readFileSync('src/App.js', 'utf8');

// For Gender row, change to horizontal layout
js = js.replace(
  /<div className="outcomer-reg-input-group">\s*<label>GENDER<\/label>\s*<div className="outcomer-gender-toggles">/g,
  '<div className="outcomer-reg-input-group outcomer-reg-gender-group">\n                <label>GENDER</label>\n                <div className="outcomer-gender-toggles">'
);

// For School select, add the chevron down
js = js.replace(
  /<select className="eternum-input" name="school" value=\{request\.school\} onChange=\{handleRequestChange\}>\s*<option value="" disabled>Select<\/option>\s*<option value="MIU">MIU<\/option>\s*<option value="BUE">BUE<\/option>\s*<option value="AUC">AUC<\/option>\s*<option value="GUC">GUC<\/option>\s*<option value="OTHER">Other<\/option>\s*<\/select>/g,
  '<div className="outcomer-reg-select-wrapper">\n                  <select className="eternum-input" name="school" value={request.school} onChange={handleRequestChange}>\n                    <option value="" disabled>Select</option>\n                    <option value="MIU">MIU</option>\n                    <option value="BUE">BUE</option>\n                    <option value="AUC">AUC</option>\n                    <option value="GUC">GUC</option>\n                    <option value="OTHER">Other</option>\n                  </select>\n                  <svg className="outcomer-reg-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="6 9 12 15 18 9"></polyline></svg>\n                </div>'
);

// For Age input, use calendar icon (current might be default)
// Wait, the reference shows a calendar icon for Age. Let's check what it is currently.
// If it's a calendar icon, leave it. We will use CSS to resize.

// For Instagram, the reference shows `@ ` inside the input placeholder or beside it.
js = js.replace(
  /<input className="eternum-input" name="instagram" placeholder="Enter your Instagram username" value=\{request\.instagram\} onChange=\{handleRequestChange\} \/>/g,
  '<div className="outcomer-reg-insta-wrapper">\n                  <span className="outcomer-reg-insta-at">@</span>\n                  <input className="eternum-input" name="instagram" placeholder="Enter your Instagram username" value={request.instagram} onChange={handleRequestChange} />\n                </div>'
);

// For Upload row
js = js.replace(
  /<span className="outcomer-reg-upload-label">UPLOAD AN IMAGE FOR YOU<\/span>\s*<span className="outcomer-reg-upload-sub">Tap to upload<\/span>/g,
  '<div className="outcomer-reg-input-group outcomer-reg-upload-group">\n                  <label>UPLOAD AN IMAGE FOR YOU</label>\n                  <span className="outcomer-reg-upload-sub">Tap to upload</span>\n                </div>\n                <svg className="outcomer-reg-chevron-right" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="9 18 15 12 9 6"></polyline></svg>'
);

// For Submit Button
js = js.replace(
  /<button\s*className="eternum-button outcomer-reg-submit"\s*onClick=\{handleOutcomerSubmit\}\s*disabled=\{isSubmitting\}\s*>\s*\{isSubmitting \? "SUBMITTING..." : "SUBMIT APPLICATION"\}\s*<\/button>/g,
  '<button\n              className="eternum-button outcomer-reg-submit"\n              onClick={handleOutcomerSubmit}\n              disabled={isSubmitting}\n            >\n              {isSubmitting ? "SUBMITTING..." : "SUBMIT APPLICATION"}\n              {!isSubmitting && <svg className="outcomer-submit-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>}\n            </button>'
);

// Change the upload structure since it is currently wrapped in an input-group?
// Let's replace the whole outcomer-reg-upload-card
js = js.replace(
  /<label className="outcomer-reg-upload-card">\s*<input type="file" accept="image\/\*" onChange=\{handleImageUpload\} \/>\s*<div className="outcomer-reg-icon">\s*<svg[^>]+>.*?<\/svg>\s*<\/div>\s*<div className="outcomer-reg-divider" \/>\s*<div className="outcomer-reg-input-group">\s*<span className="outcomer-reg-upload-label">UPLOAD AN IMAGE FOR YOU<\/span>\s*<span className="outcomer-reg-upload-sub">Tap to upload<\/span>\s*<\/div>\s*<\/label>/gs,
  `<label className="outcomer-reg-card outcomer-reg-upload-card">
              <input type="file" accept="image/*" onChange={handleImageUpload} />
              <div className="outcomer-reg-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              </div>
              <div className="outcomer-reg-divider" />
              <div className="outcomer-reg-input-group outcomer-reg-upload-group">
                <label>UPLOAD AN IMAGE FOR YOU</label>
                <span className="outcomer-reg-upload-sub">Tap to upload</span>
              </div>
              <svg className="outcomer-reg-chevron-right" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </label>`
);


fs.writeFileSync('src/App.js', js);
console.log('App.js patched.');
