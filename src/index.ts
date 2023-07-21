import * as path from 'node:path'

import type { ConfigEnv, FilterPattern, Plugin, ResolvedConfig, Rollup, Update, ViteDevServer } from 'vite'
import { createFilter, createLogger, createServer } from 'vite'
import { stringify } from 'javascript-stringify'
// @ts-ignore
import colors from 'picocolors'

import { slugify } from './slugify.ts'

// import { Visitor } from '@swc/core/Visitor'
// import type * as swc from '@swc/core'

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
            },
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
      /**
       * If Vite was unable to load SSR module, you can try this.
       */
      processWithSWC?: boolean
   }
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
   let source = ''
   for (const { classId, src, isGlobal } of entries) {
      source += '\n'
      if (isGlobal) {
         source += `\n${src}\n`
         continue
      }
      source += `.${classId} { ${src} }\n`
   }
   return source
}

const VIRTUAL_MODULE_PREFIX = '/@toad/'
const WS_EVENT_PREFIX = '@toad:hmr'
const TODAD_IDENTIFIER = '__TOAD__'
const QS_FULL_SKIP = 'toad-full-skip'

export default function(options: VitePluginToadOptions): Plugin {
   options = Object.assign(
      {
         include: [/\.(t|j)sx?/],
         exclude: [/node_modules/],
         tag: 'css',
         outputExtension: '.css',
         eval: false,
      },
      options,
   )

   const logger = createLogger('warn', { prefix: '[toad]' })
   const styleRegex = new RegExp(`(${options.tag})\\s*\`([\\s\\S]*?)\``, 'gm')
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
      return s.replace(/[^-_a-z0-9\u00A0-\uFFFF]/gi, '_').replace(/^\d/, '_')
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
      const relId = rootRel(id)
      const ext = code.match(/\/\*@toad-ext[\s]+(?<ext>.+)\*\//)?.groups?.ext
      const replaced = code.replaceAll(styleRegex, (substring, tag, _src) => {
         const src = _src.trim() as string

         const filename = relId.replace(path.extname(relId), '')
         const isGlobal = src.startsWith('/*global*/')
         const debugName = src.match(/\/\*@toad-debug[\s]+(?<debug>.+)\*\//)?.groups?.debug

         const parts: string[] = [filename]

         if (isGlobal) {
            parts.push('global')
         }
         if (debugName) {
            parts.push(debugName)
         }

         // to match SSR with common
         const castrated = src.replaceAll(/\$\{.+\}/gi, '')
         parts.push(slugify(castrated))
         const classId = toValidCSSIdentifier(parts.join('-'))
         entries.push({ classId, src, isGlobal })
         return isGlobal ? '' : `"${classId}"`
      })
      return { replaced, entries, ext }
   }

   function sendHmrUpdate(ids: string[]) {
      server.ws.send({
         type: 'update',
         updates: ids
            .map(id => {
               const mod = server.moduleGraph.getModuleById(id)
               if (!mod) {
                  return null
               }
               return <Update> {
                  type: 'js-update',
                  path: mod.id ?? mod.file,
                  acceptedPath: mod.id ?? mod.file,
                  timestamp: lastServedTime,
               }
            })
            .filter(Boolean),
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
      const extLess = id.slice(0, id.lastIndexOf('.'))
      return extLess
   }
   const isVirtual = (id: string) => id.startsWith(VIRTUAL_MODULE_PREFIX)

   // module id without extension : descriptor
   const files: Record<string, File> = {}

   const main: Plugin = {
      name: 'toad:main',
      enforce: 'pre',
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
         const [id, qs] = url.split('?')
         if (qs?.includes(QS_FULL_SKIP)) {
            return
         }
         if (isVirtual(id)) {
            return id
         }
      },
      load: {
         order: 'pre',
         async handler(url, opts) {
            const [id, qs] = url.split('?')
            if (!isVirtual(id) || qs?.includes(QS_FULL_SKIP)) {
               return
            }

            const file = files[getBaseId(id)]
            if (!file || id !== file.style.id) {
               return
            }

            if (!file.style?.sheet) {
               // Return empty because we didn't process with ssrLoadModule yet
               return ''
            }
            lastServedTime = Date.now()
            return file.style.sheet
         },
      },

      async buildStart(options) {
         if (!server) {
            logger.info(
               `${colors.blue(`Starting dev server for SSR`)}`,
               { timestamp: true },
            )
            server = await createServer({
               configFile: false,
               mode: 'production',
               logLevel: 'warn',
               server: {
                  middlewareMode: true,
               },
               // @ts-ignore
               plugins: config.plugins,
            })
         }
         return
      },
      transform: {
         order: 'pre',
         async handler(code, url, opts) {
            const [id, qs] = url.split('?')
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
                  id: baseId + (output.ext ?? options.outputExtension),
               },
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
               output.entries = ssrModule[TODAD_IDENTIFIER].entries as ParsedOutput['entries']
            }
            file.style.sheet = await createStyle(output.entries)
            file.style.hash = slugify(file.style.sheet)

            let result: string = `
               import "${file.style.id}"
               ${output.replaced}
            `

            if (!opts?.ssr) {
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
            return result
         },
      },
      buildEnd() {
         return server.close()
      },
      // Idk but it works fine without
      // fuck Vite tbh, undocumented + dead discord community
      handleHotUpdate(ctx) {
         const mods = []
         const entries = Object.values(files)
         for (const mod of ctx.modules) {
            const target = Array.from(mod.importers).find(m => entries.some(e => e.sourceId === m.id))
            if (target) {
               mods.push(target)
            }
            const related = files[getModuleVirtualId(getBaseId(mod.id))]
            if (!related) {
               continue
            }
            const toadMod = server.moduleGraph.getModuleById(related.sourceId)
            mods.push(toadMod)
         }
         return mods
      },
   }
   const ssr: Plugin = {
      name: 'toad:ssr',
      enforce: 'pre',
      async resolveId(url, importer, options) {
         if (!isVirtual(importer)) {
            return
         }
         const [id, qs] = url.split('?')
         const file = files[getBaseId(importer)]
         if (!file) {
            logger.error("can't find file " + id)
            return
         }
         // const res = path.resolve(path.dirname(file.sourceId), url)
         const res = await this.resolve(url, file.sourceId)
         return res
      },
      load: {
         order: 'pre',
         handler(url, options) {
            const [id, qs] = url.split('?')
            const file = files[getBaseId(id)]
            if (!file) {
               return
            }
            if (id === file.fakeId) {
               return file.sourceCode
            }
         },
      },
      transform: {
         order: 'pre',
         async handler(code, url, opts) {
            const [id, qs] = url.split('?')
            if ((!isVirtual(id) && !filter(id)) || !opts?.ssr) {
               return
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
                  if (typeof value === 'string') {
                     return `\`${value}\``
                  }
                  return next(value)
               })
               target += '\n' + `export const ${TODAD_IDENTIFIER} = ${jsified}`
            }

            if (!isThirdLayer && options.ssr?.customSSRTransformer) {
               try {
                  const { result, cb } = await options.ssr.customSSRTransformer(
                     target,
                     this,
                     server,
                     target,
                     id.replace(VIRTUAL_MODULE_PREFIX, '/'),
                     opts,
                  )
                  if (result) {
                     if (file) {
                        ssrTransformCallbacks.set(getBaseId(id), cb)
                     }
                     target = typeof result == 'string' ? result : result.code
                  }
               } catch (error) {
                  logger.error(
                     `${colors.red(`Failed to transform ${url} using custom transformer`)}`,
                     { timestamp: true, error },
                  )
               }
            }

            return target
         },
      },
      buildEnd(error) {
         return server.close()
      },
   }

   const plugins = [main]
   if (options.ssr?.eval) {
      plugins.push(ssr)
   }

   return Object.assign(plugins, { name: 'toad' })
}

export function skipToadForUrl(url: string) {
   let qs = url.includes('?') ? '&' : '?'
   return url + qs + QS_FULL_SKIP
}
