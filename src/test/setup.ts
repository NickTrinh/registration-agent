// Global test setup. Registers a fake IndexedDB implementation on the global
// scope so modules that reach for `indexedDB` (the catalog store in
// shared/db.ts) can run offline without a browser. See ADR 0018.
import "fake-indexeddb/auto";
