const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

css = css.replace(
  /\.eternum-wordmark-alshayeb {[\s\S]*?}/,
  `.eternum-wordmark-alshayeb {
  margin: 0 0 4px;
  color: rgba(246, 248, 255, 0.88);
  font-family: 'Michroma', 'Inter', sans-serif;
  font-size: clamp(9px, 1.6vw, 14px);
  font-weight: 400;
  letter-spacing: clamp(6px, 1.6vw, 16px);
  text-transform: uppercase;
  margin-right: calc(clamp(6px, 1.6vw, 16px) * -1); 
}`
);

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

css = css.replace(
  /\.eternum-wordmark-tagline {[\s\S]*?}/,
  `.eternum-wordmark-tagline {
  display: block;
  margin-top: 10px;
  color: rgba(0, 178, 255, 0.8);
  font-family: 'Outfit', 'Inter', sans-serif;
  font-size: clamp(9px, 1.3vw, 14px);
  font-weight: 500;
  letter-spacing: clamp(4px, 1vw, 10px);
  text-transform: uppercase;
  text-shadow: 0 0 14px rgba(0,178,255,0.65);
  margin-right: calc(clamp(4px, 1vw, 10px) * -1); 
}`
);

fs.writeFileSync('src/App.css', css);
console.log('Fixed wordmark typography to use Michroma font');
