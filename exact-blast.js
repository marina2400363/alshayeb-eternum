const fs = require('fs');
let css = fs.readFileSync('src/App.css', 'utf8');

const toReplace = [
  // 1. .reference-flow .cosmic-card
  [
    `  .reference-flow .cosmic-card {
    width: min(100%, 560px);
    min-height: calc(100vh - 44px);
    padding: clamp(28px, 7vw, 54px) clamp(22px, 6vw, 42px);
    border-radius: 26px;
    background:
      radial-gradient(circle at 50% 13%, rgba(198, 210, 255, 0.15), transparent 18%),
      radial-gradient(circle at 50% 46%, rgba(88, 111, 255, 0.18), transparent 30%),
      linear-gradient(180deg, rgba(1, 3, 9, 0.72), rgba(0, 0, 0, 0.92));
    box-shadow: inset 0 0 42px rgba(127, 157, 255, 0.055), 0 0 34px rgba(var(--dept-accent-rgb, 127, 157, 255), 0.14);
  }`,
    `  .reference-flow .cosmic-card {
    width: min(100%, 560px);
    min-height: calc(100vh - 44px);
    padding: clamp(28px, 7vw, 54px) clamp(22px, 6vw, 42px);
    border-radius: 26px;
    /* background stripped */
    box-shadow: inset 0 0 42px rgba(127, 157, 255, 0.055), 0 0 34px rgba(var(--dept-accent-rgb, 127, 157, 255), 0.14);
  }`
  ],
  // 2. .reference-flow .cosmic-card (the lookup one)
  [
    `  .reference-flow .cosmic-card {
    width: min(100%, 640px);
    min-height: 100svh;
    margin: 0 auto;
    padding: clamp(34px, 7vw, 64px) clamp(30px, 8vw, 56px);
    border: 0;
    border-radius: 0;
    background:
      linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.08) 42%, rgba(0,0,0,0.76) 70%, rgba(0,0,0,0.98) 100%);
    box-shadow: none;
    justify-content: flex-start;
  }`,
    `  .reference-flow .cosmic-card {
    width: min(100%, 640px);
    min-height: 100svh;
    margin: 0 auto;
    padding: clamp(34px, 7vw, 64px) clamp(30px, 8vw, 56px);
    border: 0;
    border-radius: 0;
    /* background stripped */
    box-shadow: none;
    justify-content: flex-start;
  }`
  ],
  // 3. .reference-flow.form-reference .cosmic-card
  [
    `.reference-flow.form-reference .cosmic-card,
.reference-flow.lookup-reference .cosmic-card {
  background:
    linear-gradient(180deg, rgba(0,0,0,0.36), rgba(0,0,0,0.82));
}`,
    `.reference-flow.form-reference .cosmic-card,
.reference-flow.lookup-reference .cosmic-card {
  /* background stripped */
}`
  ],
  // 4. .incomer-reference.tone-blue .cosmic-card
  [
    `.incomer-reference.tone-blue .cosmic-card {
  position: relative;
  width: min(100vw, calc(100vh * 0.4625));
  height: min(100vh, calc(100vw * 2.1621621622));
  min-height: 0;
  margin: 0 auto;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background:
    linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0.04) 45%, rgba(0,0,0,0.16) 68%, rgba(0,0,0,0.78) 100%);
  box-shadow: none;
}`,
    `.incomer-reference.tone-blue .cosmic-card {
  position: relative;
  width: min(100vw, calc(100vh * 0.4625));
  height: min(100vh, calc(100vw * 2.1621621622));
  min-height: 0;
  margin: 0 auto;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  /* background stripped */
  box-shadow: none;
}`
  ],
  // 5. .eternum-public-flow .cosmic-card
  [
    `.eternum-public-flow .cosmic-card {
  position: relative !important;
  width: 100% !important;
  max-width: 430px !important;
  min-height: 100dvh !important;
  height: auto !important;
  margin: 0 auto !important;
  padding: 34px 20px 48px !important;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 0 !important;
  background:
    linear-gradient(90deg, transparent calc(50% - 0.5px), rgba(69, 153, 255, 0.24) 50%, transparent calc(50% + 0.5px)),
    radial-gradient(circle at 50% 9%, rgba(111, 193, 255, 0.18), transparent 21%),
    transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  text-align: center !important;
}`,
    `.eternum-public-flow .cosmic-card {
  position: relative !important;
  width: 100% !important;
  max-width: 430px !important;
  min-height: 100dvh !important;
  height: auto !important;
  margin: 0 auto !important;
  padding: 34px 20px 48px !important;
  overflow: visible !important;
  border: 0 !important;
  border-radius: 0 !important;
  /* background stripped */
  box-shadow: none !important;
  backdrop-filter: none !important;
  text-align: center !important;
}`
  ],
  // 6. .guest-list-reference .cosmic-card
  [
    `.guest-list-reference .cosmic-card {
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
  width: min(100%, 390px) !important;
  max-width: 390px !important;
  min-height: 100dvh !important;
  height: auto !important;
  margin: 0 auto !important;
  padding: 18px 16px 14px !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  box-sizing: border-box !important;
  border: 1px solid rgba(111, 193, 255, 0.42) !important;
  border-radius: 20px !important;
  background:
    linear-gradient(90deg, transparent calc(50% - 0.5px), rgba(77, 155, 255, 0.22) 50%, transparent calc(50% + 0.5px)),
    radial-gradient(ellipse at 0% 30%, rgba(16, 60, 120, 0.18), transparent 28%),
    radial-gradient(ellipse at 100% 30%, rgba(16, 60, 120, 0.18), transparent 28%),
    rgba(2, 4, 10, 0.97) !important;
  box-shadow:
    inset 0 0 22px rgba(77, 155, 255, 0.06),
    0 0 22px rgba(77, 155, 255, 0.08) !important;
  color: #f4f6ff;
  text-align: center !important;
}`,
    `.guest-list-reference .cosmic-card {
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
  width: min(100%, 390px) !important;
  max-width: 390px !important;
  min-height: 100dvh !important;
  height: auto !important;
  margin: 0 auto !important;
  padding: 18px 16px 14px !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  box-sizing: border-box !important;
  border: 1px solid rgba(111, 193, 255, 0.42) !important;
  border-radius: 20px !important;
  /* background stripped */
  box-shadow:
    inset 0 0 22px rgba(77, 155, 255, 0.06),
    0 0 22px rgba(77, 155, 255, 0.08) !important;
  color: #f4f6ff;
  text-align: center !important;
}`
  ],
  // 7. .incomer-page-container
  [
    `.incomer-page-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  background:
  radial-gradient(
    ellipse at 50% 12%,
    rgba(24, 58, 120, 0.32),
    transparent 58%
  ),
  radial-gradient(
    ellipse at 50% 55%,
    rgba(8, 28, 75, 0.15),
    transparent 65%
  ),
  linear-gradient(
    180deg,
    #020511 0%,
    #030919 45%,
    #01030a 100%
  );
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`,
    `.incomer-page-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  /* background stripped */
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`
  ],
  // 8. .upv-page
  [
    `.upv-page {
  min-height: 100vh;
  width: 100%;
  background: #03081a;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`,
    `.upv-page {
  min-height: 100vh;
  width: 100%;
  /* background stripped */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`
  ],
  // 9. .arp-page
  [
    `.arp-page {
  min-height: 100vh;
  width: 100%;
  background: #03081a;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`,
    `.arp-page {
  min-height: 100vh;
  width: 100%;
  /* background stripped */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`
  ],
  // 10. .trk-page
  [
    `.trk-page {
  min-height: 100vh;
  width: 100%;
  background: #03081a;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`,
    `.trk-page {
  min-height: 100vh;
  width: 100%;
  /* background stripped */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`
  ],
  // 11. .tkt-page
  [
    `.tkt-page {
  min-height: 100vh;
  width: 100%;
  background: #03081a;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`,
    `.tkt-page {
  min-height: 100vh;
  width: 100%;
  /* background stripped */
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 48px;
  position: relative;
  font-family: 'Inter', -apple-system, sans-serif;
  color: #ffffff;
}`
  ],
  // 12. body
  [
    `body {
  font-family: var(--eternum-font);
  background: #000;
}`,
    `body {
  font-family: var(--eternum-font);
  background: #030918 !important;
}`
  ]
];

// Optional line ending normalization for robust matching
const normalize = str => str.replace(/\r\n/g, '\n');

let failed = 0;
for (let i = 0; i < toReplace.length; i++) {
  const [search, replace] = toReplace[i];
  const oldCss = css;
  // Try exact match
  if (css.includes(search)) {
    css = css.replace(search, replace);
  } else if (normalize(css).includes(normalize(search))) {
    css = normalize(css).replace(normalize(search), normalize(replace));
  } else {
    // Attempt loose whitespace regex match
    const looseRegex = new RegExp(search.replace(/\s+/g, '\\s+').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\!/g, '\\!'), 'g');
    if (looseRegex.test(css)) {
      css = css.replace(looseRegex, replace);
    } else {
      console.log('Failed to match block ' + (i + 1));
      failed++;
    }
  }
}

fs.writeFileSync('src/App.css', css);
console.log('App.css replacements complete. Failed: ' + failed);
