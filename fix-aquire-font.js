const fs = require('fs');

// 1. Add Aquire font to index.html
let html = fs.readFileSync('public/index.html', 'utf8');
if (!html.includes('fonts.cdnfonts.com/css/aquire')) {
  html = html.replace(
    '</head>',
    '  <link href="https://fonts.cdnfonts.com/css/aquire" rel="stylesheet">\n  </head>'
  );
  fs.writeFileSync('public/index.html', html);
  console.log('Added Aquire font to index.html');
}

// 2. Update App.css to use Aquire for ETERNUM and refine the sizes/spacing
let css = fs.readFileSync('src/App.css', 'utf8');

// The ALSHAYEB part is very wide, very spaced out, and smaller.
css = css.replace(
  /\.eternum-wordmark-alshayeb {[\s\S]*?}/,
  `.eternum-wordmark-alshayeb {
  margin: 0 0 10px;
  color: rgba(246, 248, 255, 0.88);
  font-family: 'Michroma', 'Inter', sans-serif;
  font-size: clamp(10px, 1.8vw, 15px);
  font-weight: 300;
  letter-spacing: clamp(14px, 2.5vw, 24px);
  text-transform: uppercase;
  margin-right: calc(clamp(14px, 2.5vw, 24px) * -1);
}`
);

// The ETERNUM part uses Aquire and is very large and spaced.
css = css.replace(
  /\.eternum-wordmark-eternum {[\s\S]*?}/,
  `.eternum-wordmark-eternum {
  margin: 0;
  color: white;
  font-family: 'Aquire', 'Orbitron', sans-serif;
  font-size: clamp(38px, 9.5vw, 76px);
  font-weight: 300;
  line-height: 1;
  letter-spacing: clamp(18px, 4vw, 38px);
  text-transform: uppercase;
  text-shadow: 0 0 22px rgba(255, 255, 255, 0.18);
  margin-right: calc(clamp(18px, 4vw, 38px) * -1); 
}`
);

// The tagline is NO BEGINNING. NO END.
css = css.replace(
  /\.eternum-wordmark-tagline {[\s\S]*?}/,
  `.eternum-wordmark-tagline {
  display: block;
  margin-top: 14px;
  color: rgba(92, 157, 255, 0.85);
  font-family: 'Outfit', 'Inter', sans-serif;
  font-size: clamp(10px, 1.5vw, 15px);
  font-weight: 400;
  letter-spacing: clamp(6px, 1.5vw, 12px);
  text-transform: uppercase;
  text-shadow: 0 0 14px rgba(92, 157, 255, 0.4);
  margin-right: calc(clamp(6px, 1.5vw, 12px) * -1); 
}`
);

fs.writeFileSync('src/App.css', css);
console.log('App.css updated with Aquire font and exact proportions.');
