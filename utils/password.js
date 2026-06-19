let bcryptLib = null;

try {
  bcryptLib = require('bcryptjs');
} catch {
  bcryptLib = require('bcrypt');
}

function hashPasswordSync(password) {
  return bcryptLib.hashSync(password, 10);
}

function hashPasswordAsync(password) {
  if (typeof bcryptLib.hash === 'function' && bcryptLib.hash.length >= 3) {
    return new Promise((resolve, reject) => {
      bcryptLib.hash(password, 10, (error, hash) => {
        if (error) reject(error);
        else resolve(hash);
      });
    });
  }
  return Promise.resolve(hashPasswordSync(password));
}

function comparePasswordSync(password, hash) {
  return bcryptLib.compareSync(password, hash);
}

module.exports = {
  hashPasswordSync,
  hashPasswordAsync,
  comparePasswordSync,
};
