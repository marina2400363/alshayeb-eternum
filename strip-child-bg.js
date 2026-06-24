const fs = require('fs');
let css = fs.readFileSync('src/App.css', 'utf8');

// We need to remove `background`, `background-color`, `background-image` from specific selectors.
// To do this safely, we can just replace the specific strings.

// 1. .app-shell, .ticket-page background
css = css.replace(/\.app-shell,\s*\n\s*\.ticket-page\s*\{\s*\n\s*background:\s*\n\s*radial-gradient[^;]+;\s*\n\s*\}/g, '.app-shell,\n  .ticket-page {\n    /* stripped background */\n  }');

// 2. .app-shell.tone-blue... background
css = css.replace(/(\.app-shell\.tone-blue,[^\{]+\{\s*\n\s*)background:[^;]+;/g, '$1/* stripped background */');

// 3. .app-shell... background-color
css = css.replace(/(\.app-shell,\s*\n\s*\.ticket-page,\s*\n\s*\.admin-control-page\s*\{\s*\n\s*)background-color:[^;]+;/g, '$1/* stripped background-color */');

// 4. .app, .app-shell... background-image
css = css.replace(/(\.app,\s*\n\s*\.app-shell,\s*\n\s*\.ticket-page,\s*\n\s*\.admin-control-page\s*\{\s*\n\s*)background-image:[^;]+;/g, '$1/* stripped background-image */');

// 5. .app-shell.reference-flow background
css = css.replace(/(\.app-shell\.reference-flow\s*\{[^}]*)background:[^;]+;/g, '$1/* stripped background */');

// 6. .app-shell.incomer-reference.tone-blue background
css = css.replace(/(\.app-shell\.incomer-reference\.tone-blue\s*\{[^}]*)background:[^;]+;/g, '$1/* stripped background */');

// 7. .app-shell.outcomer-reference background
css = css.replace(/(\.app-shell\.outcomer-reference\s*\{[^}]*)background:[^;]+;/g, '$1/* stripped background */');

// 8. .app-shell.eternum-public-flow background
css = css.replace(/(\.app-shell\.eternum-public-flow\s*\{[^}]*)background:[^;]+;/g, '$1/* stripped background */');

// 9. .app-shell.guest-list-reference background
css = css.replace(/(\.app-shell\.guest-list-reference\s*\{[^}]*)background:[^;]+;/g, '$1/* stripped background */');

// 10. .ticket-page standalone backgrounds
css = css.replace(/(\.ticket-page\s*\{[^}]*)background:[^;]+;/g, '$1/* stripped background */');


fs.writeFileSync('src/App.css', css);
console.log('App.css child backgrounds stripped.');
