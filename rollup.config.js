import commonjs from '@rollup/plugin-commonjs';

export default [ {
  input: './src/index.js',
  external: [
    'node:stream',
    'applicationinsights',
    'pino-abstract-transport',
  ],
  plugins: [
    commonjs(),
  ],
  output: [
    {
      file: './lib/index.cjs',
      exports: 'named',
      format: 'cjs',
      footer: 'module.exports = Object.assign(exports.default, exports);',
    },
  ],
}, {
  input: './src/fake-applicationinsights.js',
  external: [
    'node:zlib',
    'applicationinsights',
    'nock',
  ],
  plugins: [
    commonjs(),
  ],
  output: [
    {
      file: './lib/fake-applicationinsights.cjs',
      exports: 'named',
      format: 'cjs',
    },
  ],
} ];
