function convertPlaceholders(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function normalizeSqliteDialect(sql) {
  return sql
    .replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()::text')
    .replace(/date\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE::text');
}

function normalizeInsertReturning(sql) {
  const trimmed = sql.trim();
  if (/^INSERT/i.test(trimmed) && !/RETURNING/i.test(trimmed)) {
    return `${trimmed} RETURNING id`;
  }
  return sql;
}

function quoteReservedColumns(sql) {
  return sql
    .replace(/\(user_id,\s*message,\s*read\)/gi, '(user_id, message, "read")')
    .replace(/SET read =/gi, 'SET "read" =');
}

function normalizeSqlForPostgres(sql) {
  return quoteReservedColumns(
    normalizeInsertReturning(normalizeSqliteDialect(convertPlaceholders(sql)))
  );
}

module.exports = {
  normalizeSqlForPostgres,
};
