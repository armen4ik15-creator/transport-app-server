let bcryptLib = null;

try {
  bcryptLib = require('bcryptjs');
} catch {
  bcryptLib = require('bcrypt');
}

function hashPasswordSync(password) {
  return bcryptLib.hashSync(password, 10);
}

function comparePasswordSync(password, hash) {
  return bcryptLib.compareSync(password, hash);
}

module.exports = {
  hashPasswordSync,
  comparePasswordSync,
};
