function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

function isValidEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

module.exports = { normalizeEmail, isValidEmail };
