const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

// Update .outcomer-reg-card
css = css.replace(
  /min-height: 60px !important;\s*background: transparent !important;\s*border: 1px solid rgba\(255, 255, 255, 0.12\) !important;\s*border-radius: 8px !important;\s*padding: 0 20px !important;/g,
  'height: 64px !important;\n  background: transparent !important;\n  border: 1px solid rgba(255, 255, 255, 0.12) !important;\n  border-radius: 8px !important;\n  padding: 0 14px !important;\n  box-sizing: border-box !important;'
);

// Update gap between icon and text to save space
css = css.replace(
  /align-items: center !important;\s*gap: 20px !important;/g,
  'align-items: center !important;\n  gap: 14px !important;'
);

// Update placeholder font size to prevent truncation
css = css.replace(
  /\.outcomer-reg-input-group input,\s*\.outcomer-reg-input-group select \{\s*background: transparent !important;\s*border: none !important;\s*font-family: 'Inter', sans-serif !important;\s*font-size: 14px !important;/g,
  '.outcomer-reg-input-group input,\n.outcomer-reg-input-group select {\n  background: transparent !important;\n  border: none !important;\n  font-family: \'Inter\', sans-serif !important;\n  font-size: 13.5px !important;'
);

// Specifically handle placeholder font size if we want it smaller
css = css.replace(
  /\.outcomer-reg-input-group input::placeholder,\s*\.outcomer-reg-input-group select:invalid \{\s*color: rgba\(255, 255, 255, 0\.25\) !important;\s*\}/g,
  '.outcomer-reg-input-group input::placeholder,\n.outcomer-reg-input-group select:invalid {\n  color: rgba(255, 255, 255, 0.25) !important;\n  font-size: 13px !important;\n}'
);

// Reduce prefix size and gap to save space
css = css.replace(
  /\.outcomer-reg-phone-prefix \{\s*font-family: 'Inter', sans-serif !important;\s*font-size: 14px !important;/g,
  '.outcomer-reg-phone-prefix {\n  font-family: \'Inter\', sans-serif !important;\n  font-size: 13px !important;'
);
css = css.replace(
  /\.outcomer-reg-phone-wrapper \{\s*display: flex !important;\s*align-items: center !important;\s*gap: 12px !important;/g,
  '.outcomer-reg-phone-wrapper {\n  display: flex !important;\n  align-items: center !important;\n  gap: 8px !important;'
);

// Make max-width exactly fit a mobile screen (e.g. 390px instead of 420px) to prevent layout shifts
css = css.replace(
  /max-width: 420px !important; \/\* Made wider/g,
  'max-width: 100% !important; /* Let container control width */\n  width: 100% !important;'
);

fs.writeFileSync('src/App.css', css);

let js = fs.readFileSync('src/App.js', 'utf8');

const badGenderSvgRegex = /<svg width="18" height="18" viewBox="0 0 24 24"[^>]*>[\s\S]*?<\/svg>/;
const goodGenderSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"></path><line x1="11" y1="11" x2="11" y2="21"></line><line x1="8" y1="16" x2="14" y2="16"></line><line x1="13.8" y1="5.8" x2="20" y2="2"></line><polyline points="15 2 20 2 20 7"></polyline></svg>';

js = js.replace(badGenderSvgRegex, goodGenderSvg);

fs.writeFileSync('src/App.js', js);
console.log('App.css and App.js patched for mobile responsiveness and symmetry');
