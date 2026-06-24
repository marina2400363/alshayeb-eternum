const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

// Replace the pitch black gradient with a perfectly balanced DARK NAVY BLUE gradient
css = css.replace(
  /linear-gradient\(180deg, #02040B 0%, #01030A 55%, #000207 100%\) !important;/g,
  'linear-gradient(180deg, #040b19 0%, #020610 55%, #01030a 100%) !important;'
);

// Slightly restore the radial glow so it's not dead, but not as bright as 0.18
css = css.replace(
  /radial-gradient\(ellipse at 50% 0%, rgba\(40, 110, 255, 0\.10\), transparent 55%\),/g,
  'radial-gradient(ellipse at 50% 0%, rgba(40, 110, 255, 0.14), transparent 55%),'
);

// Adjust background-color fallback to dark navy
css = css.replace(
  /\.eternum-global-bg {\s*min-height: 100vh;\s*background-color: #01030A !important;\s*}/g,
  `.eternum-global-bg {\n    min-height: 100vh;\n    background-color: #020610 !important;\n  }`
);

fs.writeFileSync('src/App.css', css);
console.log('App.css global background adjusted to dark navy blue.');
