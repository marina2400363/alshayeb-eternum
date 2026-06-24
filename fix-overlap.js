const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

// Fix the height issue causing overlap
css = css.replace(
  /height: 64px !important;\s*background: transparent !important;\s*border: 1px solid rgba\(255, 255, 255, 0.12\) !important;\s*border-radius: 8px !important;\s*padding: 0 14px !important;/g,
  'min-height: 64px !important;\n  height: auto !important;\n  background: transparent !important;\n  border: 1px solid rgba(255, 255, 255, 0.12) !important;\n  border-radius: 8px !important;\n  padding: 8px 14px !important;'
);

// Reduce padding in input group to balance the card's vertical padding
css = css.replace(
  /padding: 12px 0 !important;/g,
  'padding: 6px 0 !important;'
);

fs.writeFileSync('src/App.css', css);

let js = fs.readFileSync('src/App.js', 'utf8');

// Change "Select a school" to "Select"
js = js.replace(
  /<option value="" disabled>Select a school<\/option>/g,
  '<option value="" disabled>Select</option>'
);

// Add the chevron wrapper around the select since the previous patch missed it due to dynamic schools array
js = js.replace(
  /<select className="eternum-input" name="school" value=\{request\.school\} onChange=\{handleRequestChange\}>\s*<option value="" disabled>Select<\/option>\s*\{selectedEvent\.schools\.map\(school => \(\s*<option key=\{school\} value=\{school\}>\{school\}<\/option>\s*\)\)\}\s*<\/select>/g,
  `<div className="outcomer-reg-select-wrapper">
                  <select className="eternum-input" name="school" value={request.school} onChange={handleRequestChange}>
                    <option value="" disabled>Select</option>
                    {selectedEvent.schools.map(school => (
                      <option key={school} value={school}>{school}</option>
                    ))}
                  </select>
                  <svg className="outcomer-reg-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>`
);

fs.writeFileSync('src/App.js', js);
console.log('Fixed overlap issue and dropdown chevron/text');
