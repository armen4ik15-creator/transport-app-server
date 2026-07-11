/**
 * Обработка массива с ограничением параллелизма (S3 / сеть).
 */
async function mapWithConcurrency(items, mapper, concurrency = 6) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let index = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

module.exports = { mapWithConcurrency };
