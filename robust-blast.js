const fs = require('fs');
let css = fs.readFileSync('src/App.css', 'utf8');

// A much safer way: just find the blocks using regex that looks for the selector and strips its background.
// But we must NOT use \s* inside complex background strings. We just match the block structure.

function stripBackgroundsFromBlock(selectorRegexStr) {
  // Matches the selector, then {, then anything up to background: ..., then anything up to closing }.
  // Wait, parsing CSS with regex is hard.
  
  // Easier way: split by '}' to get blocks, check if block matches selector, if so replace background.
  let blocks = css.split('}');
  for (let i = 0; i < blocks.length; i++) {
    let block = blocks[i];
    if (block.match(new RegExp(selectorRegexStr))) {
      // It matches our selector! Strip background.
      blocks[i] = block.replace(/background\s*:\s*[^;]+(;|\!important;|\!important\s*;)/g, '/* background stripped */\n  ');
    }
  }
  css = blocks.join('}');
}

stripBackgroundsFromBlock('\\.upv-page\\s*\\{');
stripBackgroundsFromBlock('\\.arp-page\\s*\\{');
stripBackgroundsFromBlock('\\.trk-page\\s*\\{');
stripBackgroundsFromBlock('\\.tkt-page\\s*\\{');
stripBackgroundsFromBlock('\\.incomer-page-container\\s*\\{');
stripBackgroundsFromBlock('\\.reference-flow \\.cosmic-card\\s*\\{');
stripBackgroundsFromBlock('\\.reference-flow\\.lookup-reference \\.cosmic-card\\s*\\{');
stripBackgroundsFromBlock('\\.incomer-reference\\.tone-blue \\.cosmic-card\\s*\\{');
stripBackgroundsFromBlock('\\.eternum-public-flow \\.cosmic-card\\s*\\{');
stripBackgroundsFromBlock('\\.guest-list-reference \\.cosmic-card\\s*\\{');

// Now explicitly fix body:
let blocks = css.split('}');
for (let i = 0; i < blocks.length; i++) {
  if (blocks[i].match(/body\s*\{/)) {
    blocks[i] = blocks[i].replace(/background\s*:\s*#000\s*;/g, 'background: #030918 !important;');
  }
}
css = blocks.join('}');

fs.writeFileSync('src/App.css', css);
console.log('App.css stripped using robust block parser.');
