import * as path from 'node:path'

import type { ConfigEnv, FilterPattern, Plugin, ResolvedConfig, Rollup, Update, ViteDevServer } from 'vite'
import { createFilter, createServer, normalizePath } from 'vite'
import { stringify } from 'javascript-stringify'

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
const STYLE_HASH_LEN = 8

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

   const jsRegex = new RegExp(`(${options.tag})\\s*\`([\\s\\S]*?)\``, 'gm')
   const ssrTransformCallbacks = new Map<string, () => void>()

   let config: ResolvedConfig
   let server: ViteDevServer
   let root: string
   let createStyle: typeof makeStyleDefault
   let lastServedTime = Date.now()

   const filter = createFilter(options.include, options.exclude)
   const rootRel = (p: string) => path.relative(root, p)

   function createHash(data, len) {
      return slugify(data)
   }

   function toValidCSSIdentifier(s: string) {
      return s.replace(/[^-_a-z0-9\u00A0-\uFFFF]/gi, '_').replace(/^\d/, '_')
   }

   type ParsedOutput = {
      replaced: string
      ext: string
      entries: StyleEntry[]
   }

   async function parseModule(id: string, code: string): Promise<ParsedOutput> {
      const entries: StyleEntry[] = []
      const relId = rootRel(id)
      const ext = code.match(/\/\*@toad-ext[\s]+(?<ext>.+)\*\//)?.groups?.ext
      const replaced = code.replaceAll(jsRegex, (substring, tag, _src) => {
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

         parts.push(createHash(src, 3))
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
      deps?: string[]

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
         // env = _env
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
      async load(url, opts) {
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
      resolveId(id) {
         if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
            return id
         }
      },
      async buildStart(options) {
         if (!server) {
            server = await createServer({
               // @ts-ignore Ensure we will not listen server
               mode: 'production',
               server: {
                  middlewareMode: true,
               },
            })
         }
      },
      transform: {
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
               deps: [],
               style: {
                  id: baseId + output.ext,
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

               const res = await server.ssrTransform(code, null, id)
               for (const dep of res.deps) {
                  const resolved = await this.resolve(dep, id)
                  if (!resolved) {
                     continue
                  }
                  const modInfo = this.getModuleInfo(resolved.id)
                  if (modInfo && !modInfo.id.includes('node_modules')) {
                     file.deps.push(modInfo.id)
                  }
               }
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
                  if (!import.meta.url.includes('?')) await new Promise(resolve => setTimeout(resolve, 100))
               }
            `
            }

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
         for (const mod of ctx.modules) {
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
            if (!filter(id) || qs?.includes(QS_FULL_SKIP) || !opts?.ssr) {
               return
            }

            let target: string = code
            const file = files[getBaseId(id)]

            if (options.ssr?.customSSRTransformer) {
               customTransform:
               try {
                  const { result, cb } = await options.ssr.customSSRTransformer(
                     code,
                     this,
                     server,
                     code,
                     id.replace(VIRTUAL_MODULE_PREFIX, '/'),
                     opts,
                  )
                  if (!result) {
                     config.logger.warn('[toad] customSSRTransformer did not return a value')
                     break customTransform
                  }
                  if (file) {
                     ssrTransformCallbacks.set(getBaseId(id), cb)
                  }
                  target = typeof result == 'string' ? result : result.code
               } catch (e) {
                  config.logger.error('[toad] Failed to transform using custom transformer', { error: e })
               }
            }
            if (!file) {
               return target
            }

            const { entries } = await parseModule(file.sourceId, target)
            const jsified = stringify({ entries }, (value, space, next, key) => {
               if (typeof value === 'string') {
                  return `\`${value}\``
               }
               return next(value)
            })
            target += '\n' + `export const ${TODAD_IDENTIFIER} = ${jsified}`
            return target
         },
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
