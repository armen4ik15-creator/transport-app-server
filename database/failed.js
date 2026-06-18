function createFailedAdapter(error) {
  const fail = () => {
    throw error;
  };

  return {
    kind: 'postgres_error',
    initError: error,
    prepare() {
      return {
        get: fail,
        all: fail,
        run: fail,
      };
    },
    transaction(fn) {
      return fn();
    },
    ping: fail,
  };
}

module.exports = { createFailedAdapter };
