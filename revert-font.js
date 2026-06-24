const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

css = css.replace(
  /\.eternum-wordmark-eternum {[\s\S]*?}/,
  `.eternum-wordmark-eternum {
  margin: 0;
  color: white;
  font-family: 'Rajdhani', 'Orbitron', sans-serif;
  font-size: clamp(48px, 11vw, 84px);
  font-weight: 300;
  line-height: 1;
  letter-spacing: clamp(14px, 3.5vw, 32px);
  text-transform: uppercase;
  text-shadow: 0 0 22px rgba(255, 255, 255, 0.18);
  margin-right: calc(clamp(14px, 3.5vw, 32px) * -1); 
}`
);

// Keep ALSHAYEB wide but thin
css = css.replace(
  /\.eternum-wordmark-alshayeb {[\s\S]*?}/,
  `.eternum-wordmark-alshayeb {
  margin: 0 0 10px;
  color: rgba(246, 248, 255, 0.88);
  font-family: 'Michroma', 'Inter', sans-serif;
  font-size: clamp(10px, 1.8vw, 15px);
  font-weight: 300;
  letter-spacing: clamp(14px, 3.5vw, 28px);
  text-transform: uppercase;
  margin-right: calc(clamp(14px, 3.5vw, 28px) * -1);
}`
);

fs.writeFileSync('src/App.css', css);
console.log('App.css updated with Rajdhani font for a premium thin feel.');
