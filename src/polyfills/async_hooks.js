export class AsyncLocalStorage {
  run(store, callback) { return callback(); }
  getStore() { return undefined; }
}
export function initializeAsyncLocalStorageSingleton() {}
