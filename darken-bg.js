const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

// Replace the global background with a much darker gradient and dimmer glow
css = css.replace(
  /linear-gradient\(180deg, #051024 0%, #030918 55%, #010206 100%\) !important;/g,
  'linear-gradient(180deg, #02040B 0%, #01030A 55%, #000207 100%) !important;'
);

// Dim the radial glow to make it darker
css = css.replace(
  /radial-gradient\(ellipse at 50% 0%, rgba\(40, 110, 255, 0\.18\), transparent 55%\),/g,
  'radial-gradient(ellipse at 50% 0%, rgba(40, 110, 255, 0.10), transparent 55%),'
);

// Also darken the background-color property just in case
css = css.replace(
  /\.eternum-global-bg {\s*min-height: 100vh;\s*background-color: #030918 !important;\s*}/g,
  `.eternum-global-bg {\n    min-height: 100vh;\n    background-color: #01030A !important;\n  }`
);

fs.writeFileSync('src/App.css', css);
console.log('App.css global background darkened successfully.');
