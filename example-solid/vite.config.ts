import path from 'node:path'

import ViteUniversal from 'vite-plugin-universal'

import ViteSolid from '/home/foxpro/sources/vite-plugin-solid/src/index.ts'

import VitePluginInspect from 'vite-plugin-inspect'
import VitePluginCivet from 'vite-plugin-civet'
import type { ConfigEnv, UserConfig } from 'vite'
import remarkMdxFrontmatter from 'remark-mdx-frontmatter'
import remarkFrontmatter from 'remark-frontmatter'
import RollupMdx from '@mdx-js/rollup'

import ViteToad from '../src/index'

export default async ({ mode }: ConfigEnv) => {
   const dev = mode === 'development'

   const config: UserConfig = {
      base: '/',
      clearScreen: false,
      server: {
         port: 3000,
      },
      preview: {
         port: 3000,
      },
      plugins: [
         {
            ...RollupMdx({
               jsx: true,
               jsxImportSource: 'solid-js',
               providerImportSource: 'solid-mdx',
               development: dev,
               remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
            }),
            enforce: 'pre',
         },
         ViteSolid({
            hot: dev,
            dev: dev,
            extensions: ['.ts', '.tsx'],
         }),
         ViteUniversal<{ head: string[]; body: string[] }>({
            entries: [
               {
                  templatePath: 'app/app.html',
                  urlAlias: '/',
                  outputPath: 'index.html',
                  isFallback: true,
               },
            ],
            applyOutput({ head, body }, template) {
               return template.replace('<!--head-->', head.join('\n')).replace('<!--body-->', body.join('\n'))
            },
         }),
         ViteToad(),
         // VitePluginInspect(),
      ],
      css: {
         modules: false,
      },
      build: {
         outDir: './dist',
         target: 'esnext',
         emptyOutDir: true,
         cssCodeSplit: true,
         modulePreload: {
            polyfill: false,
         },
         minify: false,
         rollupOptions: {
            output: {
               entryFileNames: `[name].js`,
               chunkFileNames: `assets/[name].js`,
               assetFileNames: `assets/[name].[ext]`,
            },
         },
      },
      resolve: {
         alias: [
            {
               find: '@',
               replacement: path.resolve(__dirname, './'),
            },
         ],
      },
   }
   return config
}
