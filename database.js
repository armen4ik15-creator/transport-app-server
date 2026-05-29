const { isPostgresEnabled } = require('./database/connection');

function createDatabase() {
  if (isPostgresEnabled()) {
    return require('./database/postgres').init();
  }
  return require('./database/sqlite').init();
}

const db = createDatabase();

module.exports = db;
