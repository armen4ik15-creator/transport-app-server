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
  return code && String(code).trim() ? String(code).trim() : null;
}

function getPasswordResetCode() {
  const code = process.env.PASSWORD_RESET_CODE;
  return code && String(code).trim() ? String(code).trim() : null;
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
  const open = isRegistrationOpen();
  const invite = getInviteCode();
  return {
    registration_open: open,
    registration_requires_invite: !open && Boolean(invite),
    registration_available: canSelfRegister(),
    password_reset_available: Boolean(getPasswordResetCode()),
  };
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
};
