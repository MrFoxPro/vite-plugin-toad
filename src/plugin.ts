import * as path from "node:path"

import type { ConfigEnv, FilterPattern, Plugin, ResolvedConfig, Rollup, Update, ViteDevServer } from "vite"
import { createFilter, createLogger, createServer } from "vite"
// @ts-ignore
import colors from "picocolors"
import { mergeAndConcat } from "merge-anything"
import { stringify } from "javascript-stringify"
import BabelPresetTypescript from "@babel/preset-typescript"
import BabelPluginJSX from "@babel/plugin-syntax-jsx"
import type { TransformOptions } from "@babel/core"
import { transformAsync } from "@babel/core"

import { slugify } from "./slugify.ts"
import BabelPluginCSSAttribute from "./babel-plugin-css-attribute.ts"

export type VitePluginToadOptions = {
   include?: FilterPattern
   exclude?: FilterPattern
   /**
    * Output extension.
    * @default 'css'
    */
   outputExtension?: string
   /**
    * Tag name to replace.
    * Use `createToadSelector` with this option.
    * @default 'css'
    */
   tag?: string

   /**
    * This enables transformation of `css`.
    * ```
    * css={css`
    *    color: red;
    *  `}
    * ```
    * will be merged to `class` tag.
    * Note: this uses babel transform.
    * You can use it separately by importing from `vite-plugin-toad/babel-plugin-css-attribute`
    * For example, you can combine it with `Solid` babel options. It could be slightly faster then.
    *
    * For Typescript compitability, see example in `example-solid/css-attr.d.ts`
    * @default false
    */
   transformCssAttribute?: boolean

   /**
    * Babel options that will be used when `transformCssAttribute` is true
    */
   babel?: TransformOptions

   ssr?: {
      /**
       * Load module to evaluate emplate strings
       * @default false
       */
      eval?: boolean

      /**
       * Some plugins don't respect vite `ssr: true` parameter, and they need to be processed separately
       *
       * You can process them in this callback. Make sure to output SSR-ready code
       *
       * See also: https://github.com/solidjs/vite-plugin-solid/pull/105
       */
      customSSRTransformer?(
         processedCode: string,
         ctx: Rollup.PluginContext,
         server: ViteDevServer,
         // IDK how to infer this cringy Vite type
         ...viteOptions: [
            originalCode: string,
            id: string,
            options?: {
               ssr?: boolean
            }
         ]
      ):
         | {
              result: Rollup.TransformResult
              cb?: () => void
           }
         | Promise<{
              result: Rollup.TransformResult
              cb?: () => void
           }>
   }

   makeClassName?(filename: string, style: string, debugName: string): string
   /**
    * Transform or process style of each module
    */
   createStyleMaker?(server: ViteDevServer): typeof makeStyleDefault
}

type StyleEntry = {
   classId: string
   src: string
   isGlobal: boolean
}

async function makeStyleDefault(entries: StyleEntry[]) {
   let source = ""
   for (const { classId, src, isGlobal } of entries) {
      source += "\n"
      if (isGlobal) {
         source += `\n${src}\n`
         continue
      }
      source += `.${classId} { ${src} }\n`
   }
   return source
}

const VIRTUAL_MODULE_PREFIX = "/@toad/"
const WS_EVENT_PREFIX = "@toad:hmr"
const TODAD_IDENTIFIER = "__TOAD__"
const QS_FULL_SKIP = "toad-full-skip"

export default function (options: VitePluginToadOptions): Plugin {
   options = Object.assign(
      {
         include: [/\.(t|j)sx?/],
         exclude: [/node_modules/],
         tag: "css",
         outputExtension: ".css",
         eval: false,
         transformCssAttribute: false,
         babel: {}
      },
      options
   )

   if (Array.isArray(options.include)) {
      options.include.push(new RegExp(VIRTUAL_MODULE_PREFIX))
   } else {
      // @ts-ignore
      options.include = [options.include, new RegExp(VIRTUAL_MODULE_PREFIX)]
   }

   const logger = createLogger("warn", { prefix: "[toad]" })
   const styleRegex = new RegExp(`(${options.tag})\\s*\`([\\s\\S]*?)\``, "gm")
   const ssrTransformCallbacks = new Map<string, () => void>()

   let config: ResolvedConfig
   let server: ViteDevServer
   let root: string
   let createStyle: typeof makeStyleDefault
   let lastServedTime = Date.now()
   let env: ConfigEnv

   const filter = createFilter(options.include, options.exclude)
   const rootRel = (p: string) => path.relative(root, p)

   function toValidCSSIdentifier(s: string) {
      return s.replace(/[^-_a-z0-9\u00A0-\uFFFF]/gi, "_").replace(/^\d/, "_")
   }

   type ParsedOutput = {
      replaced: string
      ext: string
      entries: StyleEntry[]
   }

   // It may be splitted for performance
   // But I can't imagine how
   async function parseModule(id: string, code: string): Promise<ParsedOutput> {
      const entries: StyleEntry[] = []
      const fileBasename = path.basename(rootRel(id))
      const filename = fileBasename.replace(path.extname(fileBasename), "")

      const ext = code.match(/\/\*@toad-ext[\s]+(?<ext>.+)\*\//)?.groups?.ext
      const replaced = code.replaceAll(styleRegex, (substring, tag, _src) => {
         const src = _src.trim() as string

         const isGlobal = src.startsWith("/*global*/")
         const debugName = src.match(/\/\*@toad-debug[\s]+(?<debug>.+)\*\//)?.groups?.debug
         let classId: string
         if (options.makeClassName) {
            classId = options.makeClassName(filename, src, debugName)
         } else {
            const parts: string[] = [filename]

            if (isGlobal) {
               parts.push("global")
            }
            if (debugName) {
               parts.push(debugName)
            }

            // to match SSR with common
            const castrated = src.replaceAll(/\$\{.+\}/gi, "")
            parts.push(slugify(castrated))
            classId = toValidCSSIdentifier(parts.join("-"))
         }
         entries.push({ classId, src, isGlobal })
         return isGlobal ? "" : `"${classId}"`
      })
      return { replaced, entries, ext }
   }

   function sendHmrUpdate(ids: string[]) {
      server.ws.send({
         type: "update",
         updates: ids
            .map((id) => {
               const mod = server.moduleGraph.getModuleById(id)
               if (!mod) {
                  return null
               }
               return <Update>{
                  type: "js-update",
                  path: mod.id ?? mod.file,
                  acceptedPath: mod.id ?? mod.file,
                  timestamp: lastServedTime
               }
            })
            .filter(Boolean)
      })
   }

   type Style = {
      id: string
      sheet?: string
      hash?: string
   }
   type File = {
      sourceId: string
      sourceCode: string
      fakeId: string
      // output?: string // filled at runtime

      style?: Style // filled at runtime
      entries?: StyleEntry[] // filled at runtime
   }
   const getModuleVirtualId = (baseId: string) => path.posix.join(VIRTUAL_MODULE_PREFIX, baseId)
   const getBaseId = (id: string) => {
      const extLess = id.slice(0, id.lastIndexOf("."))
      return extLess
   }
   const isVirtual = (id: string) => id.startsWith(VIRTUAL_MODULE_PREFIX)

   // module id without extension : descriptor
   const files: Record<string, File> = {}

   const main: Plugin = {
      name: "toad:main",
      enforce: "pre",
      config(_config, _env) {
         env = _env
      },
      configResolved(_config) {
         config = _config
         root = config.root
         createStyle = options.createStyleMaker?.(server) ?? makeStyleDefault
      },
      configureServer(_server) {
         server = _server
         server.ws.on(WS_EVENT_PREFIX, ([id, hash]: string[]) => {
            if (files[id]?.style?.hash !== hash) {
               sendHmrUpdate(Object.keys(files))
            }
         })
      },
      resolveId(url) {
         const [id, qs] = url.split("?")
         if (qs?.includes(QS_FULL_SKIP)) {
            return
         }
         if (isVirtual(id)) {
            return id
         }
      },
      load: {
         order: "pre",
         async handler(url, opts) {
            const [id, qs] = url.split("?")
            if (!isVirtual(id) || qs?.includes(QS_FULL_SKIP)) {
               return
            }

            const file = files[getBaseId(id)]
            if (!file || id !== file.style.id) {
               return
            }

            if (!file.style?.sheet) {
               // Return empty because we didn't process with ssrLoadModule yet
               return ""
            }
            lastServedTime = Date.now()
            return file.style.sheet
         }
      },

      async buildStart(options) {
         if (!server) {
            logger.info(`${colors.blue(`Starting dev server for SSR`)}`, { timestamp: true })
            server = await createServer({
               configFile: false,
               base: config.base,
               root: config.root,
               resolve: config.resolve,
               mode: "production",
               logLevel: "silent",
               server: {
                  middlewareMode: true
               },
               // @ts-ignore
               plugins: config.plugins.filter((pl) => !pl.name.startsWith("vite:"))
            })
         }
         return
      },
      transform: {
         order: "pre",
         async handler(code, url, opts) {
            const [id, qs] = url.split("?")
            if (!filter(id) || isVirtual(id) || qs?.includes(QS_FULL_SKIP)) {
               return
            }

            // We need to parse it here anyway and in SSR too
            // I didn't find the way to parse it only once
            // Impossible to use output from SSR as code is different
            // And I don't know if I can split parseModule without `replaceAll`
            const output = await parseModule(id, code)

            if (!output.entries.length) {
               return
            }

            const baseId = getModuleVirtualId(getBaseId(id))
            const file: File = {
               sourceId: id,
               fakeId: getModuleVirtualId(id),
               sourceCode: code,
               style: {
                  id: baseId + (output.ext ?? options.outputExtension)
               }
            }
            files[baseId] = file

            const fakeModuleId = getModuleVirtualId(id)
            if (options.ssr?.eval) {
               const prevFakeModuke = server.moduleGraph.getModuleById(fakeModuleId)
               if (prevFakeModuke) {
                  server.moduleGraph.invalidateModule(prevFakeModuke)
               }

               const ssrModule = await server.ssrLoadModule(fakeModuleId, { fixStacktrace: true })
               ssrTransformCallbacks.get(baseId)?.()
               ssrTransformCallbacks.delete(baseId)
               output.entries = ssrModule[TODAD_IDENTIFIER].entries as ParsedOutput["entries"]
            }
            file.style.sheet = await createStyle(output.entries)
            file.style.hash = slugify(file.style.sheet)

            let result: string = `
               import "${file.style.id}"
               ${output.replaced}
            `

            if (env.command === "serve" && !opts?.ssr) {
               result += `
               if (import.meta.hot) {
                  try { await import.meta.hot.send('${WS_EVENT_PREFIX}', ["${baseId}", "${file.style.hash}"]); }
                  catch (e) { console.warn('${WS_EVENT_PREFIX}', e) }
                  if (!import.meta.url.includes('?')) await new Promise(resolve => setTimeout(resolve, 300))
               }
            `
            }

            // After updating styles, need to refetch them
            const sMod = server.moduleGraph.getModuleById(file.style.id)
            if (sMod) {
               server.moduleGraph.invalidateModule(sMod)
               sMod.lastHMRTimestamp = sMod.lastInvalidationTimestamp || Date.now()
            }

            if (options.transformCssAttribute) {
               const babelOptions = mergeAndConcat(options.babel, {
                  babelrc: false,
                  configFile: false,
                  root,
                  filename: id,
                  sourceFileName: id,
                  presets: [[BabelPresetTypescript, { onlyRemoveTypeImports: true }]],
                  plugins: [
                     [BabelPluginJSX, {}],
                     [BabelPluginCSSAttribute, {}],
                  ],
                  sourceMaps: true,
                  // Vite handles sourcemap flattening
                  inputSourceMap: false as any
               } satisfies TransformOptions)
               const { code, map } = await transformAsync(result, babelOptions)
               return { code, map }
            }

            return result
         }
      },
      buildEnd() {
         return server.close()
      },
      // Idk but it works fine without
      // fuck Vite tbh, undocumented + dead discord community
      handleHotUpdate(ctx) {
         if (!filter(ctx.file)) {
            return
         }

         const entries = Object.values(files)
         const affected = server.moduleGraph.getModulesByFile(ctx.file)
         for (const mod of ctx.modules) {
            affected.add(mod)
         }
         if (!affected.size) {
            return
         }

         for (const mod of affected) {
            const importers = Array.from(mod.importers).filter((m) => entries.some((e) => e.sourceId === m.id))
            if (importers.length) {
               logger.info(`${colors.blue(`Found targets to include in as dependency in HMR:`)}`, {
                  timestamp: true
               })
               logger.info(`${colors.green(importers.map((imp) => imp.id).join(", "))}`, {
                  timestamp: true
               })
               // add each importer of `mod` that contains css-in-js to HMR
               for (const importer of importers) {
                  affected.add(importer)
               }
            }
            // if there is toad file for this affected module
            const related = files[getModuleVirtualId(getBaseId(mod.id))]
            if (related) {
               const toadMod = server.moduleGraph.getModuleById(related.sourceId)
               affected.add(toadMod)
            }
         }
         return Array.from(affected)
      }
   }
   const ssr: Plugin = {
      name: "toad:ssr",
      enforce: "pre",
      async resolveId(url, importer, options) {
         if (!importer || !isVirtual(importer)) {
            return
         }
         const [id, qs] = url.split("?")
         const file = files[getBaseId(importer)]
         if (!file) {
            logger.error("can't find file " + id)
            return
         }
         const res = await this.resolve(url, file.sourceId, options)
         return res
      },
      load: {
         order: "pre",
         handler(url, options) {
            const [id, qs] = url.split("?")
            const file = files[getBaseId(id)]
            if (!file) {
               return
            }
            if (id === file.fakeId) {
               return file.sourceCode
            }
         }
      },
      transform: {
         order: "pre",
         async handler(code, url, opts) {
            const [id, qs] = url.split("?")
            if (!filter(id) || !opts?.ssr) {
               return
            }
            const isModVirtual = isVirtual(id)
            const mod = server.moduleGraph.getModuleById(id)

            if (!isModVirtual) {
               if (!mod?.importers?.size) {
                  return
               }
               const importers = Array.from(mod.importers)
               if (!importers.some((importer) => isVirtual(importer.id))) {
                  return
               }
            }

            const isThirdLayer = qs?.includes(QS_FULL_SKIP)
            let target: string = code
            let entries: StyleEntry[]

            const fileId = isThirdLayer ? getModuleVirtualId(getBaseId(id)) : getBaseId(id)
            const file = files[fileId]

            if (file) {
               const result = await parseModule(file.sourceId, target)
               entries = result.entries
               target = result.replaced
               const jsified = stringify({ entries }, (value, space, next, key) => {
                  if (typeof value === "string") {
                     return `\`${value}\``
                  }
                  return next(value)
               })
               target += "\n" + `export const ${TODAD_IDENTIFIER} = ${jsified}`
            }

            if (!isThirdLayer && options.ssr?.customSSRTransformer) {
               try {
                  const { result, cb } = await options.ssr.customSSRTransformer(
                     target,
                     this,
                     server,
                     target,
                     id.replace(VIRTUAL_MODULE_PREFIX, "/"),
                     opts
                  )
                  if (result) {
                     if (file) {
                        ssrTransformCallbacks.set(getBaseId(id), cb)
                     }
                     target = typeof result == "string" ? result : result.code
                  }
               } catch (error) {
                  logger.error(`${colors.red(`Failed to transform ${url} using custom transformer`)}`, {
                     timestamp: true,
                     error
                  })
               }
            }

            return target
         }
      },
      buildEnd(error) {
         return server.close()
      }
   }

   const plugins = [main]
   if (options.ssr?.eval) {
      plugins.push(ssr)
   }

   return Object.assign(plugins, { name: "toad" })
}

export function skipToadForUrl(url: string) {
   let qs = url.includes("?") ? "&" : "?"
   return url + qs + QS_FULL_SKIP
}
