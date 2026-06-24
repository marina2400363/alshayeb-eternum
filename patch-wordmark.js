const fs = require('fs');

let js = fs.readFileSync('src/App.js', 'utf8');

// 1. Add EternumWordmark component definition
const wordmarkComponent = `
const EternumWordmark = ({ title = "ETERNUM", subtitle = "NO BEGINNING. NO END." }) => (
  <div className="eternum-wordmark-container">
    <div className="eternum-wordmark-alshayeb">ALSHAYEB</div>
    <div className="eternum-wordmark-eternum">{title}</div>
    {subtitle && <div className="eternum-wordmark-tagline">{subtitle}</div>}
  </div>
);
`;

if (!js.includes('const EternumWordmark')) {
  js = js.replace('const BrandHeader =', wordmarkComponent + '\nconst BrandHeader =');
}

// 2. Replace BrandHeader internals
const oldBrandHeaderContent = `    <div className="brand-header-typography">
      <p className="brand-header-alshayeb">ALSHAYEB</p>
      <div className="brand-header-eternum">{title}</div>
      {subtitle && <p className="brand-header-subtitle">{subtitle}</p>}
    </div>`;
const newBrandHeaderContent = `    <div className="brand-header-typography">
      <EternumWordmark title={title} subtitle={subtitle} />
    </div>`;

js = js.replace(oldBrandHeaderContent, newBrandHeaderContent);

// 3. Replace Home page title
const oldHomeBrand = `      <div className="home-brand">
        <p className="home-brand-alshayeb">ALSHAYEB</p>
        <h1 className="home-brand-eternum">ETERNUM</h1>
        <span className="home-brand-tagline">NO BEGINNING. NO END.</span>
      </div>`;
const newHomeBrand = `      <div className="home-brand">
        <EternumWordmark />
      </div>`;

js = js.replace(oldHomeBrand, newHomeBrand);

fs.writeFileSync('src/App.js', js);
console.log('App.js patched with EternumWordmark');

// 4. Append CSS classes
let css = fs.readFileSync('src/App.css', 'utf8');

const wordmarkCss = `
/* =========================================================================
   UNIFIED ETERNUM WORDMARK
   ========================================================================= */
.eternum-wordmark-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  position: relative;
  z-index: 3;
  line-height: 1;
}

.eternum-wordmark-alshayeb {
  margin: 0 0 4px;
  color: rgba(246, 248, 255, 0.88);
  font-family: 'Inter', sans-serif;
  font-size: clamp(10px, 1.8vw, 16px);
  font-weight: 300;
  letter-spacing: clamp(6px, 1.4vw, 14px);
  text-transform: uppercase;
  /* Apply negative margin equal to letter-spacing to ensure perfect centering */
  margin-right: calc(clamp(6px, 1.4vw, 14px) * -1); 
}

.eternum-wordmark-eternum {
  margin: 0;
  color: white;
  font-size: clamp(32px, 8vw, 64px);
  font-weight: 200;
  line-height: 1;
  letter-spacing: clamp(10px, 2.8vw, 28px);
  text-transform: uppercase;
  text-shadow: 0 0 22px rgba(255, 255, 255, 0.18);
  /* Apply negative margin equal to letter-spacing to ensure perfect centering */
  margin-right: calc(clamp(10px, 2.8vw, 28px) * -1); 
}

.eternum-wordmark-tagline {
  display: block;
  margin-top: 10px;
  color: rgba(0, 178, 255, 0.8);
  font-family: 'Outfit', 'Inter', sans-serif;
  font-size: clamp(9px, 1.3vw, 14px);
  font-weight: 400;
  letter-spacing: clamp(3px, 0.8vw, 8px);
  text-transform: uppercase;
  text-shadow: 0 0 14px rgba(0,178,255,0.65);
  /* Apply negative margin equal to letter-spacing to ensure perfect centering */
  margin-right: calc(clamp(3px, 0.8vw, 8px) * -1); 
}
`;

if (!css.includes('.eternum-wordmark-container')) {
  fs.writeFileSync('src/App.css', css + '\n' + wordmarkCss);
  console.log('App.css patched with eternum-wordmark CSS');
} else {
  console.log('App.css already has eternum-wordmark CSS');
}
