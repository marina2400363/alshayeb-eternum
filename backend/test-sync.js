require("dotenv").config();
const mongoose = require("mongoose");
const { syncEventExportSheet } = require("./src/services/googleSheetsExportSync");

async function testSync() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB.");
  
  try {
    console.log("Running syncEventExportSheet for 'Eternity'...");
    await syncEventExportSheet("Eternity");
    console.log("Sync complete.");
  } catch (err) {
    console.error("Sync failed:", err);
  } finally {
    mongoose.disconnect();
  }
}

testSync();
