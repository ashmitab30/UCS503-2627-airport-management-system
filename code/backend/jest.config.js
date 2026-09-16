/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  // The backend is native ESM ("type": "module" in package.json). Jest's
  // default transform assumes CommonJS, so we tell it to treat .js as ESM
  // and run with `node --experimental-vm-modules` (see package.json "test" script).
  transform: {},
};
