const fs = require('fs');
let css = fs.readFileSync('src/App.css', 'utf8');

// Update .els-overlay to be transparent so the global background shows through
css = css.replace(/(\.els-overlay\s*\{[^}]*)background:\s*#[0-9a-fA-F]+;/g, '$1background: transparent;');

// Update .eternum-global-bg::before with a richer navy blue gradient instead of pure black.
css = css.replace(
  /linear-gradient\(180deg,\s*#02040B 0%,\s*#01030A 55%,\s*#000207 100%\)\s*!important/g,
  'linear-gradient(180deg, #051024 0%, #030918 55%, #010206 100%) !important'
);
// Also update the base background-color from #01030A to the new mid-tone #030918
css = css.replace(
  /\.eternum-global-bg\s*\{\s*\n\s*min-height:\s*100vh;\s*\n\s*background-color:\s*#01030A\s*!important;\s*\n\}/g,
  '.eternum-global-bg {\n  min-height: 100vh;\n  background-color: #030918 !important;\n}'
);


fs.writeFileSync('src/App.css', css);
console.log('App.css adjusted for richer navy blue and transparent loader.');
