import path from 'node:path'

import type { Options as SolidOptions } from 'vite-plugin-solid'
import ViteSolid from 'vite-plugin-solid'
import VitePluginInspect from 'vite-plugin-inspect'
import type { ConfigEnv, UserConfig } from 'vite'
import ViteSolidSVG from 'vite-plugin-solid-svg'

import ViteToad, { skipToadForUrl } from '../src/index'

export default async ({ mode }: ConfigEnv) => {
   const dev = mode === 'development'

   const solidOptions: Partial<SolidOptions> = {
      hot: dev,
      dev: dev,
      solid: {
         generate: 'dom',
      },
      typescript: {
         onlyRemoveTypeImports: true,
      },
   }

   const config: UserConfig = {
      base: '/',
      clearScreen: false,
      logLevel: 'info',
      server: {
         port: 3000,
      },
      preview: {
         port: 3000,
      },
      plugins: [
         ViteSolid(solidOptions),
         ViteSolidSVG({
            defaultAsComponent: true
         }),
         ViteToad({
            // outputExtension: '.scss',
            tag: 'css',
            ssr: {
               eval: true,
               async customSSRTransformer(code, ctx, server, _c, url) {
                  solidOptions.solid.generate = 'ssr'
                  const solidPlugin = server.config.plugins.find(p => p.name === 'solid')
                  const result = await solidPlugin.transform(code, skipToadForUrl(url), { ssr: true })
                  // or
                  // const result = await server.transformRequest(skipToadForUrl(url), { ssr: true })
                  return {
                     result,
                     // this will be called when we will transform all dependencies
                     cb: () => {
                        solidOptions.solid.generate = 'dom'
                     },
                  }
               },
            },
         }),
         VitePluginInspect({
            silent: true,
         }),
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
