const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

css = css.replace(
  /0 0 0 1000px rgba\(4, 8, 24, 0\.55\) inset,/g,
  '0 0 0 1000px #060C1F inset,'
);

// We need to also add color: #F3F7FF !important; just in case some browsers ignore -webkit-text-fill-color
css = css.replace(
  /-webkit-text-fill-color: #F3F7FF !important;/g,
  '-webkit-text-fill-color: #F3F7FF !important;\n  color: #F3F7FF !important;'
);

fs.writeFileSync('src/App.css', css);
console.log('Fixed autofill transparency issue by using solid hex color');
