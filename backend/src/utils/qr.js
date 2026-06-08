const crypto = require("crypto");

function generateShortCode(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let i = 0; i < length; i += 1) {
    const index = crypto.randomInt(0, alphabet.length);
    code += alphabet[index];
  }

  return code;
}

async function generateUniqueQrId(Attendee) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const qrId = `ALSHAYEB-${generateShortCode()}`;
    const existing = await Attendee.exists({ qrId });

    if (!existing) {
      return qrId;
    }
  }

  throw new Error("Could not generate a unique QR ID.");
}

function generateQrToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  generateQrToken,
  generateUniqueQrId
};
