const fs = require('fs');
let css = fs.readFileSync('src/App.css', 'utf8');

// The main body::before was replaced by .eternum-global-bg, which means the old radial-gradients are gone.
// Let's add .admin-bg::before back manually.

const adminBgBefore = `
.admin-bg::before {
  content: "";
  position: fixed;
  inset: 0;
  background:
    radial-gradient(circle at 50% 12%, rgba(93, 124, 255, 0.18), transparent 28%),
    radial-gradient(circle at 18% 28%, rgba(22, 80, 156, 0.18), transparent 20%),
    radial-gradient(circle at 82% 24%, rgba(48, 90, 170, 0.16), transparent 20%),
    radial-gradient(circle at 50% 76%, rgba(212, 169, 63, 0.07), transparent 24%),
    linear-gradient(180deg, #02040b 0%, #030712 48%, #000 100%);
  opacity: 1;
  z-index: -4;
}
`;

// Insert it right after the body block
css = css.replace(/(letter-spacing: 0;\n})/, '$1\n' + adminBgBefore);

// Now let's remove any trace of .eternum-page-bg
// It might be at the bottom of the file
css = css.replace(/\.eternum-page-bg\s*\{[^}]+\}/g, '');
css = css.replace(/\.eternum-page-bg::before\s*\{[^}]+\}/g, '');

// Also ensure we have the correct .eternum-global-bg
const eternumGlobalBg = `
.eternum-global-bg {
  min-height: 100vh;
  background-color: #01030A !important;
}

.eternum-global-bg::before {
  content: "";
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(40, 110, 255, 0.18), transparent 55%),
    radial-gradient(ellipse at 50% 50%, rgba(10, 30, 80, 0.08), transparent 70%),
    linear-gradient(180deg, #02040B 0%, #01030A 55%, #000207 100%) !important;
  opacity: 1;
  z-index: -4;
  pointer-events: none;
}

.eternum-global-bg .animated-bg {
  display: none !important;
}
`;

// Add it to the very bottom
css += '\n' + eternumGlobalBg + '\n';

fs.writeFileSync('src/App.css', css);
console.log('App.css fixed!');
