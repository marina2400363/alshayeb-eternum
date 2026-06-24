const fs = require('fs');
let appJs = fs.readFileSync('src/App.js', 'utf8');

appJs = appJs.replace(/ eternum-page-bg/g, '');

fs.writeFileSync('src/App.js', appJs);
console.log('App.js cleaned of old page-bg classes.');
