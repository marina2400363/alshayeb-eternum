require("dotenv").config();
const { google } = require("googleapis");

async function verifyGoogleAuth() {
  console.log("Verifying Google Service Account Setup...\n");

  const email = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    console.error("❌ ERROR: GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY is missing from your .env file.");
    process.exit(1);
  }

  // Handle newlines securely
  privateKey = privateKey.replace(/\\n/g, "\n");

  try {
    const auth = new google.auth.JWT({
  email,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

    // Test authentication
    await auth.authorize();
    
    console.log("✅ SUCCESS: Service Account is perfectly authenticated!");
    console.log(`\nEmail used for authentication: ${email}`);
    console.log("\nIMPORTANT: Ensure you have shared your Target Export Google Sheet(s) with the email address above as an 'Editor'.");

  } catch (error) {
    console.error("❌ ERROR: Authentication failed.");
    console.error("Details:", error.message);
    if (error.message.includes("key")) {
       console.error("\nHint: Your GOOGLE_PRIVATE_KEY might be malformed. Ensure it's wrapped in quotes in the .env file and contains \\n for newlines.");
    }
  }
}

verifyGoogleAuth();
