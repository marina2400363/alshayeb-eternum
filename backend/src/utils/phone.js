function cleanPhone(value) {
  // First, remove absolutely all non-digit characters (including weird unicode spaces/letters)
  let cleaned = String(value || "").replace(/\D/g, "").trim();
  
  // Normalize Egyptian country code (+20 or 20) to standard 01... format
  if (cleaned.startsWith("20") && cleaned.length >= 12) {
    cleaned = "0" + cleaned.slice(2);
  } else if (cleaned.startsWith("1") && cleaned.length === 10) {
    cleaned = "0" + cleaned;
  }
  
  return cleaned;
}

function isEgyptianPhone(value) {
  return /^01[0-9]{9}$/.test(cleanPhone(value));
}

module.exports = {
  cleanPhone,
  isEgyptianPhone
};
