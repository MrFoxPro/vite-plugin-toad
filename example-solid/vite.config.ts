import path from 'node:path'

import type { Options as SolidOptions } from 'vite-plugin-solid'
import ViteSolid from 'vite-plugin-solid'
import VitePluginInspect from 'vite-plugin-inspect'
import type { ConfigEnv, UserConfig } from 'vite'

import ViteToad from '../src/index'

export default async ({ mode }: ConfigEnv) => {
   const dev = mode === 'development'

   const solidOptions: Partial<SolidOptions> = {
      hot: dev,
      dev: dev,
      solid: {
         generate: 'dom',
      },
   }

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
         ViteSolid(),
         ViteToad({
            ssr: {
               eval: true,
               async customSSRTransformer(code, ctx, server, ...viteOptions) {
                  solidOptions.solid.generate = 'ssr'
                  solidOptions.solid.hydratable = false
                  const result = await server.transformRequest(viteOptions[1], { ssr: true })
                  solidOptions.solid.generate = 'dom'
                  return result
               },
            },
         }),
         VitePluginInspect(),
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
