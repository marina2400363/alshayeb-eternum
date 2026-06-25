const fs = require("fs");
let app = fs.readFileSync("src/App.js", "utf8");

app = app.replace(
  /window\.addEventListener\("popstate", handlePopState\);\r?\n\s+return \(\) => window\.removeEventListener\("popstate", handlePopState\);/,
  `const handleForceGoHome = () => {
      setPage("home");
    };

    window.addEventListener("popstate", handlePopState);
    window.addEventListener("forceGoHome", handleForceGoHome);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("forceGoHome", handleForceGoHome);
    };`
);

app = app.replace(
  /window\.location\.href = "\/";/,
  `window.dispatchEvent(new CustomEvent("forceGoHome"));`
);

fs.writeFileSync("src/App.js", app, "utf8");
console.log("App.js updated for hamburger home button");

