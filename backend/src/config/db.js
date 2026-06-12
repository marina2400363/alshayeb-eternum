const mongoose = require("mongoose");

async function connectDb() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is required.");
  }

  mongoose.set("strictQuery", true);

  try {
    const connection = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
      family: 4,
    });

    console.log(`MongoDB Atlas connected: ${connection.connection.host}`);
    return connection;
  } catch (err) {
    console.error("FULL ERROR:");
    console.error(err);
    throw err;
  }
}

module.exports = connectDb;