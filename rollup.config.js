import babel from '@rollup/plugin-babel'
import del from 'rollup-plugin-delete'

/** @type {import('rollup').OutputOptions} */
const output = {}
/** @type {import('rollup').RollupOptions} */
export default {
   input: './src/index.ts',
   external: ['vite', 'node:path', 'node:fs/promises'],
   treeshake: 'smallest',
   output: [
      {
         ...output,
         format: 'esm',
         dir: 'dist/esm',
      },
      {
         ...output,
         format: 'cjs',
         dir: 'dist/cjs',
      },
   ],
   plugins: [
      babel({
         extensions: ['.ts'],
         babelHelpers: 'bundled',
         presets: ['@babel/preset-typescript'],
         exclude: /node_modules\//,
      }),
      del({ targets: 'dist/*' }),
   ],
}
