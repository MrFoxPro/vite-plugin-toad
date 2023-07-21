import * as path from 'node:path'

import type { Plugin, ResolvedConfig, FilterPattern, ViteDevServer, Update, ConfigEnv, Rollup } from 'vite'
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
      ): {
         result: Rollup.TransformResult
         cb?: () => void 
      } | Promise<{
         result: Rollup.TransformResult
         cb?: () => void 
      }>
       /**
       * If Vite was unable to load SSR module, you can try this.
       * 
       */
      processWithSWC?: boolean
   }
   /**
    * Transform or process style of each module
    */
   transformStyle?(server: ViteDevServer, collectedSource: string): string | Promise<string>
}
const VIRTUAL_MODULE_PREFIX = '/@toad/virtual'
const WS_EVENT_PREFIX = '@toad:hmr'
const TODAD_IDENTIFIER = '__TOAD__'
const QS_SSR = 'toad-ssr'
const QS_FULL_SKIP = 'toad-full-skip'
const STYLE_HASH_LEN = 5

export default function (options: VitePluginToadOptions): Plugin {
   options = Object.assign(
      {
         include: [/\.(t|j)sx?/],
         exclude: [/node_modules/],
         tag: 'css',
         outputExtension: '.css',
         eval: false,
      },
      options
   )


   const jsRegex = new RegExp(`(${options.tag})\\s*\`([\\s\\S]*?)\``, 'gm')
   const ssrTransformCallbacks = new Map<string, () => void>()

   let config: ResolvedConfig
   let server: ViteDevServer
   let root: string

   let lastServedTime = Date.now()

   type VirtualModuleData = {
      hash: string
      src: string
      ownerId: string
      deps: string[]
      ext?: string
   }
   const state: {
      [id: string]: VirtualModuleData
   } = {}

   const filter = createFilter(options.include, options.exclude)
   const rootRel = (p: string) => path.relative(root, p)
   function createHash(data, len) {
      return slugify(data).slice(len)
   }

   function getToadModuleId(modId: string, ext = options.outputExtension) {
      ext ??= options.outputExtension
      return path.posix.join(VIRTUAL_MODULE_PREFIX, modId.replace(path.extname(modId), ext))
   }

   function sendHmrUpdate(ids: string[]) {
      server.ws.send({
         type: 'update',
         updates: ids
            .map(id => {
               const vMod = server.moduleGraph.getModuleById(id)
               if (!vMod) return null
               return <Update>{
                  type: 'js-update',
                  path: vMod.id ?? vMod.file,
                  acceptedPath: vMod.id ?? vMod.file,
                  timestamp: lastServedTime,
               }
            })
            .filter(Boolean),
      })
   }

   function toValidCSSIdentifier(s: string) {
      return s.replace(/[^-_a-z0-9\u00A0-\uFFFF]/gi, '_').replace(/^\d/, '_')
   }

   type StyleEntry = {
      classId: string
      src: string
      isGlobal: boolean
   }
   function processModule(id: string, code: string) {
      const entries: StyleEntry[] = []
      const relId = rootRel(id)
      const ext = code.match(/\/\*@toad-ext[\s]+(?<ext>.+)\*\//)?.groups?.ext
      const transformed = code.replaceAll(jsRegex, (substring, tag, _src) => {
         const src = _src.trim() as string

         const filename = relId.replace(path.extname(relId), '')
         const isGlobal = src.startsWith('/*global*/')
         const debugName = src.match(/\/\*@toad-debug[\s]+(?<debug>.+)\*\//)?.groups?.debug

         const parts: string[] = [filename]

         if (isGlobal) parts.push('global')
         if (debugName) parts.push(debugName)

         parts.push(createHash(src, 3))
         const classId = toValidCSSIdentifier(parts.join('-'))
         entries.push({ classId, src, isGlobal })
         return isGlobal ? '' : `"${classId}"`
      })
      return [transformed, entries, ext] as const
   }
   function createHMRScript(id: string, hash: string) {
      return `
         if (import.meta.hot) {
            try { await import.meta.hot.send('${WS_EVENT_PREFIX}', ["${id}", "${hash}"]); }
            catch (e) { console.warn('${WS_EVENT_PREFIX}', e) }
            if (!import.meta.url.includes('?')) await new Promise(resolve => setTimeout(resolve, 100))
         }
      `
   }

   const main: Plugin = {
      name: 'toad:main',
      enforce: 'pre',
      config(_config, _env) {
         // env = _env
      },
      configResolved(_config) {
         config = _config
         root = config.root
      },
      configureServer(_server) {
         server = _server
         server.ws.on(WS_EVENT_PREFIX, ([id, hash]: string[]) => {
            if (state[id]?.hash !== hash) sendHmrUpdate(Object.keys(state))
         })
      },
      resolveId(id) {
         if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
            return id
         }
      },
      load(url) {
         const [id, qs] = url.split('?')
         if (qs?.includes(QS_FULL_SKIP)) return
         if (!id.startsWith(VIRTUAL_MODULE_PREFIX)) return
         const source = state[id]
         if (!source) {
            if (qs?.includes(QS_SSR)) return ''
            config.logger.error(`[toad] Failed to resolve ${url}`)
            return
         }
         lastServedTime = Date.now()
         return source.src
      },
      async buildStart(options) {
         if (server) return
         server = await createServer({
            // @ts-ignore Ensure we will not listen server
            mode: 'production',
            server: {
               middlewareMode: true,
            },
         })
      },
      async transform(code, url, opts) {
         const [id, qs] = url.split('?')
         if (!filter(id) || qs?.includes(QS_SSR)) return

         const [processedCode, entries, ext] = processModule(id, code)
         if (entries.length == 0) return code

         const vModId = getToadModuleId(id, ext)

         const vMod = server.moduleGraph.getModuleById(vModId)
         if (vMod) {
            server.moduleGraph.invalidateModule(vMod)
            vMod.lastHMRTimestamp = vMod.lastInvalidationTimestamp || Date.now()
         }

         let result: string = `
import "${vModId}"
${processedCode}
         `
         if (!opts?.ssr && code.includes('import.meta.hot')) {
            const vMod = Object.values(state).find(entry => entry.ownerId === id)
            if (vMod) result += createHMRScript(id, vMod.hash)
         }

         state[vModId] = {
            src: '',
            hash: null,
            ownerId: id,
            deps: [],
         }

         async function createStyle(vModId: string, entries: StyleEntry[]) {
            for (const { classId, src, isGlobal } of entries) {
               state[vModId].src += '\n'
               if (isGlobal) {
                  state[vModId].src += `\n${src}\n`
                  continue
               }
               state[vModId].src += `.${classId} {
                  ${src}
               }\n`
            }
            state[vModId].hash = createHash(state[vModId].src, STYLE_HASH_LEN)
         }

         if (!options.ssr?.eval) {
            await createStyle(vModId, entries)
            return result
         }
         const mod = await server.ssrLoadModule(id + '?' + QS_SSR, { fixStacktrace: true })
         ssrTransformCallbacks.get(id)?.()
         ssrTransformCallbacks.delete(id)
         const evaluatedEntries = mod[TODAD_IDENTIFIER] as StyleEntry[]
         await createStyle(vModId, evaluatedEntries)

         const res = await server.ssrTransform(code, null, id)
         for (const dep of res.deps) {
            const resolved = await this.resolve(dep, id)
            if (!resolved) continue
            const modInfo = this.getModuleInfo(resolved.id)
            if (modInfo && !modInfo.id.includes('node_modules')) {
               state[vModId].deps.push(modInfo.id)
            }
         }
         return result
         // return null
         // const result = await swc.parse(code, {
         //    syntax: 'typescript',
         //    target: 'esnext',
         //    tsx: true,
         // })
         // const visitor = new ToadVisitor()
         // const reverted = await swc.print(result, {
         //    plugin: m => visitor.visitProgram(m),
         // })
      },
      buildEnd() {
         return server.close()
      },
      // Idk but it works fine without this bullshit
      // fuck Vite tbh
      // undocumented + dead discord community
      handleHotUpdate(ctx) {
         const mods = ctx.modules.filter(mod => !mod.id.includes(QS_SSR))
         for (const mod of mods) {
            server.moduleGraph.invalidateModule(mod)

            // const related = Object.entries(state).find(([id, { ownerId }]) => ownerId === mod.id)
            // if (!related) continue
            // const toadMod = server.moduleGraph.getModuleById(related[0])
            // if (toadMod) {
            //    server.moduleGraph.invalidateModule(toadMod)
            // }
         }
         return mods
      },
   }

   const preSsr: Plugin = {
      name: 'toad:ssr',
      enforce: 'pre',
      transform: {
         order: 'pre',
         handler(code, url, opts) {
            const [id, qs] = url.split('?')
            if (!filter(id)) return
            if(!qs?.includes(QS_FULL_SKIP) && !qs?.includes(QS_SSR)) return

            const [processedCode, entries, ext] = processModule(id, code)
            const jsEntries = stringify(entries, (value, space, next, key) => {
               if (typeof value === 'string') {
                  return `\`${value}\``
               }
               return next(value)
            })
            return `
               ${processedCode}
               export const ${TODAD_IDENTIFIER} = ${jsEntries}
            `
         },
      },
   }
   const ssr: Plugin = {
      name: 'toad:ssr-middleware',
      enforce: 'pre',
      transform: {
         async handler(code, url, opts) {
            const [id, qs] = url.split('?')
            if (!filter(id)) return
            if (qs?.includes(QS_FULL_SKIP)) return
            if (!opts?.ssr) return

            let moduleCode = code
            if (options.ssr?.customSSRTransformer) {
               try {
                  const { result, cb } = await options.ssr.customSSRTransformer(code, this, server, code, url, opts)
                  if (result) {
                     ssrTransformCallbacks.set(id, cb)
                     moduleCode = typeof result == 'string' ? result : result.code
                  } else config.logger.warn('[toad] customSSRTransformer did not return a value')
               } catch (e) {
                  config.logger.error('[toad] Failed to transform using custom transformer', { error: e })
               }
            }
            return moduleCode
         },
      },
   }

   const styles: Plugin = {
      name: 'toad:styles',
      async transform(code, url, opts) {
         const [id, qs] = url.split('?')
         if (qs?.includes(QS_SSR)) return
         if (!id.startsWith(VIRTUAL_MODULE_PREFIX) || qs?.includes(QS_FULL_SKIP)) return
         const mod = state[id]
         if (!mod) {
            config.logger.warn(`[toad:styles]: Unable to find cached module ${id}`)
            return
         }
         const result = await options.transformStyle!(server, mod.src)
         mod.src = result
         mod.hash = createHash(mod.src, STYLE_HASH_LEN)
         return mod.src
      },
   }
   const plugins = [main]
   if (options.transformStyle) plugins.push(styles)
   if (options.ssr?.customSSRTransformer) plugins.push(preSsr, ssr)

   return Object.assign(plugins, { name: 'toad' })
}

export function skipToadForUrl(url: string) {
   let qs =  url.includes('?') ? '&' : '?'
   return url + qs + QS_FULL_SKIP
}
