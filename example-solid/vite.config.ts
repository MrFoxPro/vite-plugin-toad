import path from "node:path"

import ViteSvgJsx from 'vite-plugin-svg-jsx'
import ViteSolidSVG from "vite-plugin-solid-svg"
import type { Options as SolidOptions } from "vite-plugin-solid"
import ViteSolid from "vite-plugin-solid"
import VitePluginInspect from "vite-plugin-inspect"
import type { ConfigEnv, UserConfig } from "vite"

import ViteToad from "../src/plugin"

export default async ({ mode }: ConfigEnv) => {
   const dev = mode === "development"

   const config: UserConfig = {
      base: "/",
      clearScreen: false,
      logLevel: "info",
      server: {
         port: 3000
      },
      preview: {
         port: 3000
      },
      plugins: [
         ViteSolid({
            hot: dev,
            dev: dev,
            solid: {
               generate: "dom"
            },
            include: [/(\.svg)|(.(t|j)sx?)/],
         }),
         ViteSolidSVG({
            defaultAsComponent: true,
         }),
         // ViteSvgJsx(),
         ViteToad({
            // outputExtension: '.scss',
            tag: "css",
            transformCssAttribute: true,
            // include: [],
            ssr: {
               eval: true,
               babelOptions: { presets: [["solid", { generate: "ssr", hydratable: false }]] },
            }
         }),
         VitePluginInspect({
            silent: true
         })
      ],
      css: {
         modules: false
      },
      build: {
         outDir: "./dist",
         target: "esnext",
         emptyOutDir: true,
         cssCodeSplit: true,
         modulePreload: {
            polyfill: false
         },
         minify: false,
         rollupOptions: {
            output: {
               entryFileNames: `[name].js`,
               chunkFileNames: `assets/[name].js`,
               assetFileNames: `assets/[name].[ext]`
            }
         }
      },
      resolve: {
         alias: [
            {
               find: "@",
               replacement: path.resolve(__dirname, "./")
            }
         ]
      }
   }
   return config
}
