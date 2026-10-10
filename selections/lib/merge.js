'use strict';
// Patch semantics shared by the server and the browser app:
//   - plain objects merge recursively
//   - arrays and scalars replace
//   - null deletes the key
function deepMerge(target, patch) {
  Object.keys(patch || {}).forEach((k) => {
    const v = patch[k];
    if (v === null) { delete target[k]; return; }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  });
  return target;
}

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));

module.exports = { deepMerge, clone };
