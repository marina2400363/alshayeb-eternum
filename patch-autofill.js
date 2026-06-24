const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

const autofillCss = `
/* =========================================================================
   AUTOFILL OVERRIDES
   ========================================================================= */
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
textarea:-webkit-autofill,
textarea:-webkit-autofill:hover,
textarea:-webkit-autofill:focus,
select:-webkit-autofill,
select:-webkit-autofill:hover,
select:-webkit-autofill:focus {
  -webkit-text-fill-color: #F3F7FF !important;
  caret-color: #F3F7FF !important;
  box-shadow: 
    0 0 0 1000px rgba(4, 8, 24, 0.55) inset, 
    inset 0 0 10px rgba(80, 140, 255, 0.04) !important;
  -webkit-box-shadow: 
    0 0 0 1000px rgba(4, 8, 24, 0.55) inset, 
    inset 0 0 10px rgba(80, 140, 255, 0.04) !important;
  border: 1px solid rgba(110, 170, 255, 0.18) !important;
  transition: background-color 9999s ease-in-out 0s !important;
}
`;

if (!css.includes(':-webkit-autofill')) {
  fs.writeFileSync('src/App.css', css + '\n' + autofillCss);
  console.log('App.css patched with autofill styles.');
} else {
  console.log('App.css already has autofill styles.');
}

let js = fs.readFileSync('src/App.js', 'utf8');

// Replace eternum-input with autofill off attributes
// Using a regex that doesn't duplicate if already present
if (!js.includes('autoComplete="new-password"')) {
  js = js.replace(/className="eternum-input"(?!\s+autoComplete)/g, 'className="eternum-input" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false}');
  
  // Also fix forms
  js = js.replace(/<form /g, '<form autoComplete="off" ');
  
  fs.writeFileSync('src/App.js', js);
  console.log('App.js patched with autofill attributes.');
} else {
  console.log('App.js already has autofill attributes.');
}
