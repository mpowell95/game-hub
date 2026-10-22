// The app modules copied into shared/js/ (tools/sync-functions-shared.mjs) were written for a
// phone: a few touch localStorage when they load. On the server there is none, so give them an
// empty one. Imported FIRST by boards.js, before any shared module evaluates.
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
}
