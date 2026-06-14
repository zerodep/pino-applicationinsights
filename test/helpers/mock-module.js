import { mock } from 'node:test';

const nodeMajor = Number(process.versions.node.split('.', 1)[0]);
const supportsExportsOption = nodeMajor >= 24;

/**
 * Version-agnostic `mock.module` wrapper.
 *
 * Node 24 deprecated `namedExports`/`defaultExport` in favour of a single
 * `exports` object, and its CJS mock loader overlays the provided named exports
 * onto `exports.default` with `Object.defineProperty`. Handing it a live ESM
 * namespace whose `default` points at a compiled-TypeScript CJS package
 * (non-configurable getter exports, e.g. `applicationinsights`) makes that
 * redefine throw `Cannot redefine property`. We always pass a fresh,
 * configurable, `default`-free copy of the named exports so the loader builds a
 * brand-new exports object instead.
 *
 * @param {string} specifier
 * @param {{ namedExports?: Record<string, unknown>, defaultExport?: unknown }} [parts]
 * @returns {ReturnType<typeof mock.module>}
 */
export function mockModule(specifier, { namedExports = {}, defaultExport } = {}) {
  const named = { ...namedExports };
  delete named.default;
  delete named.__esModule;

  if (supportsExportsOption) {
    const exports = defaultExport === undefined ? named : { ...named, default: defaultExport };
    return mock.module(specifier, { cache: false, exports });
  }

  const options = { cache: false, namedExports: named };
  if (defaultExport !== undefined) options.defaultExport = defaultExport;
  return mock.module(specifier, options);
}

/**
 * Mock the `applicationinsights` peer dep with a loaded version namespace
 * (`applicationinsights` or the aliased `applicationinsights-v3`).
 * @param {Record<string, unknown>} ai
 * @returns {ReturnType<typeof mock.module>}
 */
export function mockApplicationinsights(ai) {
  return mockModule('applicationinsights', { namedExports: ai });
}
