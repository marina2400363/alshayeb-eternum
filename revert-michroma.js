const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

// Switch ETERNUM back to Michroma
css = css.replace(
  /\.eternum-wordmark-eternum {[\s\S]*?}/,
  `.eternum-wordmark-eternum {
  margin: 0;
  color: white;
  font-family: 'Michroma', 'Inter', sans-serif;
  font-size: clamp(34px, 8.5vw, 68px);
  font-weight: 400;
  line-height: 1;
  letter-spacing: clamp(10px, 3.2vw, 32px);
  text-transform: uppercase;
  text-shadow: 0 0 22px rgba(255, 255, 255, 0.18);
  margin-right: calc(clamp(10px, 3.2vw, 32px) * -1); 
}`
);

// Switch ALSHAYEB back to Michroma with proper proportions
css = css.replace(
  /\.eternum-wordmark-alshayeb {[\s\S]*?}/,
  `.eternum-wordmark-alshayeb {
  margin: 0 0 4px;
  color: rgba(246, 248, 255, 0.88);
  font-family: 'Michroma', 'Inter', sans-serif;
  font-size: clamp(9px, 1.6vw, 14px);
  font-weight: 400;
  letter-spacing: clamp(8px, 2.2vw, 20px);
  text-transform: uppercase;
  margin-right: calc(clamp(8px, 2.2vw, 20px) * -1);
}`
);

fs.writeFileSync('src/App.css', css);
console.log('App.css reverted to Michroma font entirely.');
