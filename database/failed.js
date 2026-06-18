function createFailedAdapter(error) {
  const fail = () => {
    const err = new Error(
      'Сервер подключается к базе данных. Подождите 30 секунд и попробуйте снова.'
    );
    err.status = 503;
    err.internalCause = error;
    throw err;
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
