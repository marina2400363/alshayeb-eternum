function cleanPhone(value) {
  let cleaned = String(value || "").replace(/[\s'-]/g, "").trim();
  
  // Normalize Egyptian country code (+20 or 20) to standard 01... format
  if (cleaned.startsWith("+20")) {
    cleaned = "0" + cleaned.slice(3);
  } else if (cleaned.startsWith("201")) {
    cleaned = "0" + cleaned.slice(2);
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
