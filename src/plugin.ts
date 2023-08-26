import * as Path from "node:path"
import fs from "node:fs/promises"

import type { ConfigEnv, ModuleNode, Plugin, ResolvedConfig, Update, ViteDevServer } from "vite"
import { createFilter, createLogger, createServer, transformWithEsbuild } from "vite"
// @ts-ignore
import colors from "picocolors"
import { mergeAndConcat } from "merge-anything"
import { stringify } from "javascript-stringify"
import * as t from "@babel/types"
import * as babel from "@babel/core"

import { slugify } from "./slugify.ts"
import type { VitePluginToadOptions } from "./options.ts"
import BabelPluginCssAttribute from "./babel-plugin-css-attribute.ts"

export default function (options: VitePluginToadOptions): Plugin {
   options = mergeAndConcat(
      {
         mode: "babel",
         include: [/\.(t|j)sx?/],
         exclude: [/node_modules/],
         tag: "css",
         outputExtension: ".css",
         ssr: {
            eval: false,
            babelOptions: {}
         },
         customAttribute: {
            enable: false,
            name: "css"
         }
      } satisfies VitePluginToadOptions,
      options
   )

   const VIRTUAL_MODULE_PREFIX = "/@toad/module/"
   const VIRTUAL_STYLE_PREFIX = "/@toad/style/"
   const WS_EVENT_PREFIX = "@toad:hmr"
   const TODAD_IDENTIFIER = "__TOAD__"
   const QS_FULL_SKIP = "toad-full-skip"

   if (Array.isArray(options.include)) {
      options.include.push(new RegExp(VIRTUAL_MODULE_PREFIX))
   } else if (options.include) {
      // @ts-ignore
      options.include = [options.include, new RegExp(VIRTUAL_MODULE_PREFIX)]
   }
   const filter = createFilter(options.include, options.exclude)

   const logger = createLogger("warn", {
      prefix: "[toad]"
   })

   let config: ResolvedConfig
   let server: ViteDevServer
   let lastServedTime = Date.now()
   let env: ConfigEnv

   function toValidCSSIdentifier(s: string) {
      return s.replace(/[^-_a-z0-9\u00A0-\uFFFF]/gi, "_").replace(/^\d/, "_")
   }

   // to match SSR template with non-SSR template
   function getIndependentStyleHash(style: string) {
      const castrated = style.replaceAll(/\$\{.+\}/gi, "")
      return slugify(castrated)
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

   const createStyle =
      options.createStyle ??
      function createStyle(className: string, template: string, isGlobal: boolean) {
         if (isGlobal) {
            return `${template}\n`
         }
         return `.${className} { ${template} }\n`
      }

   const createClassName =
      options.createClassName ??
      function createClassName(ctx: { filename: string; isGlobal: boolean; debugName: string; hash: string }) {
         const parts = [ctx.filename]
         if (ctx.isGlobal) {
            parts.push("global")
         }
         if (ctx.debugName) {
            parts.push(ctx.debugName)
         }
         parts.push(ctx.hash)
         const className = toValidCSSIdentifier(parts.join("-"))
         return className
      }

   const getBaseId = (id: string) => {
      const extLess = id.slice(0, id.lastIndexOf("."))
      return extLess
   }

   const isVirtualId = (id: string) => id.startsWith("/@toad/")

   const isVirtualModuleId = (id: string) => id.startsWith(VIRTUAL_MODULE_PREFIX)
   const getModuleVirtualId = (baseId: string) => Path.posix.join(VIRTUAL_MODULE_PREFIX, baseId)
   const getModuleRealId = (virtualId: string) => virtualId.replace(VIRTUAL_MODULE_PREFIX, "/")

   const getStyleVirtualID = (id: string) => Path.posix.join(VIRTUAL_STYLE_PREFIX, id)
   const isVirtualStyleId = (id: string) => id.startsWith(VIRTUAL_STYLE_PREFIX)

   type Target = {
      realModuleId: string
      vModuleId: string
      vStyleId?: string
      style: {
         sheet: string
         hash: string
      } // filled at runtime
   }
   // module id without extension : descriptor
   const targets: Target[] = []

   const findTargetByVirtualModuleId = (vModId: string) => targets.find((x) => x.vModuleId === vModId)
   const findTargetByVirtualStyleId = (vStyleId: string) => targets.find((x) => x.vStyleId === vStyleId)
   const findTargetByRealModuleId = (modId: string) => targets.find((x) => x.realModuleId === modId)

   function processTemplate(template: string, ctx: { filename: string }) {
      const isGlobal = /[\s]*\/\*global\*\//.test(template)
      const debugName = template.match(/\/\*@toad-debug[\s]+(?<debug>.+)\*\//)?.groups?.debug

      const hash = getIndependentStyleHash(template)
      const className = createClassName({
         debugName,
         isGlobal,
         hash,
         filename: ctx.filename.replace(Path.extname(ctx.filename), "")
      })
      const style = createStyle(className, template, isGlobal)
      return { className, style }
   }

   type ProcessedModuleOutput = {
      type: "regex" | "babel"
      ext: string
      styles: string[]
      transformed: { code: string; map?: any }
   }

   async function transformBabelModuleGenerateStyles(id: string, code: string) {
      const filename = Path.basename(id)

      const output: ProcessedModuleOutput = {
         type: "babel",
         ext: null,
         styles: [] as string[],
         transformed: {
            code: null,
            map: null
         }
      }

      const plugins: babel.PluginItem[] = [
         {
            visitor: {
               TaggedTemplateExpression(path, state) {
                  const node = path.node
                  if (node.tag.type !== "Identifier") return
                  if (node.tag.name !== options.tag) return

                  // remove ` from start and end
                  const template = code.slice(node.quasi.start + 1, node.quasi.end - 1)

                  const { className, style } = processTemplate(template, { filename })

                  path.replaceWith(t.stringLiteral(className))

                  output.styles.push(style)
               }
            }
         }
      ]
      if (options.customAttribute.enable) {
         plugins.push([BabelPluginCssAttribute, { attribute: options.customAttribute.name }])
      }

      // @ts-ignore
      output.transformed = await babel.transformAsync(code, {
         filename,
         parserOpts: { plugins: ["jsx", "typescript"] },
         plugins
      })

      output.ext = code.match(/\/\*@toad-ext[\s]+(?<ext>.+)\*\//)?.groups?.ext

      return output
   }

   async function transformRegexModuleGenerateStyles(id: string, code: string) {
      const filename = Path.basename(id)

      const ext = code.match(/\/\*@toad-ext[\s]+(?<ext>.+)\*\//)?.groups?.ext
      const styleRegex = new RegExp(`(${options.tag})\\s*\`([\\s\\S]*?)\``, "gm")

      const styles: string[] = []

      const transformedCode = code.replaceAll(styleRegex, (substring, tag, _src) => {
         const template = _src.trim() as string
         // // to match SSR with common
         // const castrated = src.replaceAll(/\$\{.+\}/gi, "")
         const { className, style } = processTemplate(template, { filename })
         styles.push(style)
         return `"${className}"`
      })
      // TODO sourcemaps
      const output: ProcessedModuleOutput = {
         type: "regex",
         ext,
         styles,
         transformed: {
            code: transformedCode
         }
      }
      return output
   }

   const main: Plugin = {
      name: "toad:main",
      enforce: "pre",
      config(_config, _env) {
         env = _env
      },
      configResolved(_config) {
         config = _config
      },
      configureServer(_server) {
         server = _server
         server.ws.on(WS_EVENT_PREFIX, ([id, hash]: string[]) => {
            const target = findTargetByVirtualModuleId(id)
            if (target?.style?.hash !== hash) {
               sendHmrUpdate(targets.map((x) => x.realModuleId))
            }
         })
      },
      resolveId(url) {
         const [id, qs] = url.split("?")
         if (qs?.includes(QS_FULL_SKIP)) {
            return
         }
         if (isVirtualId(id)) {
            return id
         }
      },
      load: {
         order: "pre",
         async handler(url, opts) {
            const [id, qs] = url.split("?")
            if (!isVirtualStyleId(id)) {
               return
            }

            const target = findTargetByVirtualStyleId(id)
            if (!target) {
               return
            }

            if (!target.style?.sheet) {
               // Return empty because we didn't process with ssrLoadModule yet
               return ""
            }
            lastServedTime = Date.now()
            return target.style.sheet
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
            if (!filter(id) || isVirtualId(id) || qs?.includes(QS_FULL_SKIP)) {
               return
            }

            let output: ProcessedModuleOutput

            const vModId = getModuleVirtualId(id)
            if (options.ssr?.eval) {
               const prevFakeModuke = server.moduleGraph.getModuleById(vModId)
               if (prevFakeModuke) {
                  server.moduleGraph.invalidateModule(prevFakeModuke)
               }
               const ssrModule = await server.ssrLoadModule(vModId, { fixStacktrace: true }).catch((_) => _)
               if (ssrModule instanceof Error) {
                  logger.error(
                     "There was an error when evaluating module in SSR mode." +
                        "\nMake sure you specified needed SSR configuration via `ssr.babelOptions` and `ssr.forceEsbuildOnDependencies` plugin options\n" +
                        ssrModule.toString(),
                     { error: ssrModule }
                  )
                  return
               }
               output = tMap.get(vModId)
               output.styles = ssrModule[TODAD_IDENTIFIER].styles
            } else {
               if (options.mode === "babel") {
                  output = await transformBabelModuleGenerateStyles(id, code)
               } else {
                  output = await transformRegexModuleGenerateStyles(id, code)
               }
            }

            if (!output.styles.length) {
               return
            }

            const sheet = output.styles.join("\n")

            let target: Target
            const tIndex = targets.findIndex((t) => t.realModuleId === id)
            const vStyleId = getStyleVirtualID(getBaseId(id) + (output.ext ?? options.outputExtension))
            if (tIndex === -1) {
               target = {
                  realModuleId: id,
                  vModuleId: getModuleVirtualId(id),
                  vStyleId: vStyleId,
                  style: {
                     sheet,
                     hash: slugify(sheet)
                  }
               }
               targets.push(target)
            } else {
               target = targets[tIndex]
               target.vStyleId = vStyleId
               target.style.sheet = sheet
               target.style.hash = slugify(sheet)
            }

            output.transformed.code = `import "${target.vStyleId}"\n` + output.transformed.code

            if (env.command === "serve" && !opts?.ssr) {
               output.transformed.code += `
if (import.meta.hot) {
   try { await import.meta.hot.send('${WS_EVENT_PREFIX}', ["${vModId}", "${target.style.hash}"]) }
   catch(e) { console.warn('${WS_EVENT_PREFIX}', e) }
   if (!import.meta.url.includes('?')) await new Promise(resolve => setTimeout(resolve, 300))
}`
            }

            // After updating styles, need to refetch them
            const sMod = server.moduleGraph.getModuleById(target.vStyleId)
            if (sMod) {
               server.moduleGraph.invalidateModule(sMod)
               sMod.lastHMRTimestamp = sMod.lastInvalidationTimestamp || Date.now()
            }

            return output.transformed
         }
      },
      buildEnd() {
         return server.close()
      },

      handleHotUpdate(ctx) {
         if (!filter(ctx.file)) {
            return
         }
         const affected = server.moduleGraph.getModulesByFile(ctx.file) ?? new Set<ModuleNode>()
         for (const mod of ctx.modules) {
            affected.add(mod)
         }

         if (!affected.size) {
            return
         }

         for (const mod of affected) {
            const importers = Array.from(mod.importers).filter((m) => targets.some((e) => e.realModuleId === m.id))
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
            const related = findTargetByRealModuleId(mod.id)
            if (related) {
               const toadMod = server.moduleGraph.getModuleById(related.realModuleId)
               if (toadMod) affected.add(toadMod)
            }
         }
         return Array.from(affected)
      }
   }

   const tMap = new Map<string, string>()
   const ssr: Plugin = {
      name: "toad:ssr",
      enforce: "post",
      async resolveId(url, importer, options) {
         const [id, qs] = url.split("?")

         if (!importer || !isVirtualModuleId(importer)) {
            return
         }
         const res = await this.resolve(url, getModuleRealId(importer), options)
         return res.id
      },
      load: {
         order: "post",
         async handler(url, opts) {
            const [id, qs] = url.split("?")

            if (isVirtualModuleId(id)) {
               const realId = getModuleRealId(id)
               const content = await fs.readFile(realId, { encoding: "utf-8" })
               return content
            }
            if (isVirtualStyleId(id)) {
               return ""
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
            const isVirtualMod = isVirtualModuleId(id)
            const mod = server.moduleGraph.getModuleById(id)

            // If it's not virtual module, we only need to process it in case if it's imported by virtual module
            if (!isVirtualMod) {
               if (!mod?.importers?.size) {
                  return
               }
               const importers = Array.from(mod.importers)
               if (!importers.some((importer) => isVirtualModuleId(importer.id))) {
                  return
               }
            }

            let output: ProcessedModuleOutput
            if (options.mode === "babel") {
               output = await transformBabelModuleGenerateStyles(id, code)
            } else {
               output = await transformRegexModuleGenerateStyles(id, code)
            }

            const jsifiedStyles = stringify({ styles: output.styles }, (value, space, next, key) => {
               if (typeof value === "string") return `\`${value}\``
               return next(value)
            })
            output.transformed.code += `export const ${TODAD_IDENTIFIER} = ${jsifiedStyles}`
            output.styles = null
            tMap.set(id, output)

            return output.transformed
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
