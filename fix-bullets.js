const fs = require("fs");
let css = fs.readFileSync("src/App.css", "utf8");

css = css.replace(
  /\.rule-card \{[\s\S]*?\}/,
  `.rule-card {
  display: flex;
  align-items: center;
  background: rgba(5, 14, 36, 0.4);
  border: 1px solid rgba(0, 178, 255, 0.15);
  border-radius: 8px;
  padding: 16px;
}`
);

css = css.replace(
  /\.rule-num \{[\s\S]*?\}/,
  `.rule-num {
  font-family: 'Michroma', 'Inter', sans-serif;
  font-size: 20px;
  color: #00b2ff;
  width: 50px;
  flex-shrink: 0;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid rgba(0, 178, 255, 0.2);
  margin-right: 16px;
  padding-right: 16px;
}`
);

fs.writeFileSync("src/App.css", css, "utf8");
console.log("App.css updated");

