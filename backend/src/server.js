//const dns = require("dns");
//dns.setServers(["8.8.8.8", "1.1.1.1"]);

require("dotenv").config();

const app = require("./app");
const connectDb = require("./config/db");
const startCronJobs = require("./services/cronJobs");

const port = process.env.PORT || 5000;
console.log("URI:", process.env.MONGODB_URI);

connectDb()
  .then(() => {
    startCronJobs();
    app.listen(port, () => {
      console.log(`ALSHAYEB ETERNUM API listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start API:", error.message);
    process.exit(1);
  });
