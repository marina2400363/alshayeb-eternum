const fs = require("fs");
let css = fs.readFileSync("src/App.css", "utf8");

css = css.replace(
  /\.rules-brand-logo \{[\s\S]*?\.rules-brand-logo::after \{[\s\S]*?\}/,
  `.rules-brand-logo {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  letter-spacing: 0.3em;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
}`
);

css = css.replace(
  /\.rules-footer \{[\s\S]*?\}/,
  `.rules-footer {
  text-align: center;
  margin: 40px auto 0 auto;
  border-top: 1px solid rgba(0, 178, 255, 0.2);
  border-bottom: 1px solid rgba(0, 178, 255, 0.2);
  padding: 16px 24px;
  background: rgba(0, 178, 255, 0.03);
  max-width: fit-content;
}`
);

fs.writeFileSync("src/App.css", css, "utf8");
console.log("App.css updated");

