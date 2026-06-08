function cleanPhone(value) {
  return String(value || "").replace(/\s/g, "").replace(/'/g, "").trim();
}

function isEgyptianPhone(value) {
  return /^01[0-9]{9}$/.test(cleanPhone(value));
}

module.exports = {
  cleanPhone,
  isEgyptianPhone
};
