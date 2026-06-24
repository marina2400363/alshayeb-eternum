const fs = require('fs');

let css = fs.readFileSync('src/App.css', 'utf8');

css = css.replace(
  /background-image: url\('\.\.\/public\/spade-reference\.png'\);/,
  "background-image: url('../public/references/homepage-background-spade.png');"
);

fs.writeFileSync('src/App.css', css);
console.log('App.css background image path updated successfully.');
