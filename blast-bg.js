const fs = require('fs');
let css = fs.readFileSync('src/App.css', 'utf8');

const regexesToRemove = [
  // Page wrappers
  /(\.upv-page\s*\{[^}]*)background:\s*#03081a;/g,
  /(\.arp-page\s*\{[^}]*)background:\s*#03081a;/g,
  /(\.trk-page\s*\{[^}]*)background:\s*#03081a;/g,
  /(\.tkt-page\s*\{[^}]*)background:\s*#03081a;/g,
  /(\.incomer-page-container\s*\{\s*background:\s*radial-gradient[^;]+;\s*\n)/g,
  
  // Full-screen cosmic-cards that block the background
  /(\.reference-flow \.cosmic-card\s*\{[^}]*)background:[^;]+;/g,
  /(\.reference-flow\.lookup-reference \.cosmic-card\s*\{[^}]*)background:[^;]+;/g,
  /(\.incomer-reference\.tone-blue \.cosmic-card\s*\{[^}]*)background:[^;]+;/g,
  /(\.eternum-public-flow \.cosmic-card\s*\{[^}]*)background:[^;]+!important;/g,
  /(\.guest-list-reference \.cosmic-card\s*\{[^}]*)background:[^;]+!important;/g,
];

for (let r of regexesToRemove) {
  css = css.replace(r, '$1/* background stripped */');
}

// Ensure .incomer-page-container is actually stripped. The regex might fail if formatting is slightly different.
css = css.replace(/\.incomer-page-container\s*\{\s*background:\s*radial-gradient[\s\S]*?100%\s*\);\s*/g, '.incomer-page-container {\n  /* background stripped */\n  ');

fs.writeFileSync('src/App.css', css);
console.log('App.css child backgrounds blasted.');
