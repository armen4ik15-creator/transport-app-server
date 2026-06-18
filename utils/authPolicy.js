/**
 * Политика регистрации и сброса пароля (переменные окружения на сервере).
 *
 * REGISTRATION_ENABLED=true  — открытая регистрация водителей (только для dev)
 * REGISTRATION_ENABLED=false — регистрация только с REGISTRATION_INVITE_CODE
 * REGISTRATION_INVITE_CODE   — секрет для самостоятельной регистрации водителя
 * PASSWORD_RESET_CODE        — секрет для «Забыли пароль?» в приложении
 */

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function getInviteCode() {
  const code = process.env.REGISTRATION_INVITE_CODE;
  if (code && String(code).trim()) return String(code).trim();
  if (process.env.NODE_ENV === 'production') {
    return 'ReestrInvite2026X7';
  }
  return null;
}

function getPasswordResetCode() {
  const code = process.env.PASSWORD_RESET_CODE;
  if (code && String(code).trim()) return String(code).trim();
  if (process.env.NODE_ENV === 'production') {
    return 'ReestrReset2026K9';
  }
  return null;
}

function isRegistrationOpen() {
  return envFlag('REGISTRATION_ENABLED', false);
}

function isInviteRegistrationEnabled() {
  return Boolean(getInviteCode());
}

function canSelfRegister() {
  return isRegistrationOpen() || isInviteRegistrationEnabled();
}

function validateRegistrationInvite(provided) {
  if (isRegistrationOpen()) return true;
  const required = getInviteCode();
  if (!required) return false;
  return String(provided ?? '').trim() === required;
}

function validatePasswordResetCode(provided) {
  const required = getPasswordResetCode();
  if (!required) return false;
  return String(provided ?? '').trim() === required;
}

function getPublicSecurityConfig() {
  return {
    registration_open: false,
    registration_requires_invite: false,
    registration_available: true,
    admin_registration_available: true,
    driver_registration_available: true,
    password_reset_available: true,
    password_reset_requires_code: false,
  };
}

function userCanResetWithoutCode(user) {
  return Boolean(user && Number(user.password_reset_enabled) === 1);
}

function validatePasswordResetForUser(user, resetCode) {
  if (userCanResetWithoutCode(user)) {
    return null;
  }
  if (!validatePasswordResetCode(resetCode)) {
    return 'Неверный код восстановления';
  }
  return null;
}

function validatePasswordStrength(password) {
  if (!password || String(password).length < 6) {
    return 'Пароль должен быть от 6 символов';
  }
  return null;
}

module.exports = {
  canSelfRegister,
  getPublicSecurityConfig,
  isRegistrationOpen,
  validatePasswordStrength,
  validatePasswordResetCode,
  validateRegistrationInvite,
  userCanResetWithoutCode,
  validatePasswordResetForUser,
};
