const mongoose = require("mongoose");

async function connectDb() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is required. Use a MongoDB Atlas connection string.");
  }

 // if (!uri.startsWith("mongodb+srv://")) {
   // throw new Error("MONGODB_URI must be a MongoDB Atlas mongodb+srv:// connection string.");
  //}

  mongoose.set("strictQuery", true);

  try {
  const connection = await mongoose.connect(uri, {
  serverSelectionTimeoutMS: 30000,
  connectTimeoutMS: 30000,
  socketTimeoutMS: 30000,
  family: 4
});


  console.log(`MongoDB Atlas connected: ${connection.connection.host}`);
} catch (err) {
  console.error("FULL ERROR:");
  console.error(err);
  throw err;
}


  console.log(`MongoDB Atlas connected: ${connection.connection.host}`);
  return connection;
}

module.exports = connectDb;
