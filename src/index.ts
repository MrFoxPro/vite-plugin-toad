import * as path from 'node:path'
import * as crypto from 'node:crypto'

import type { Plugin, ResolvedConfig, FilterPattern, ViteDevServer, Update, ConfigEnv, Rollup } from 'vite'
import { createFilter, createServer, normalizePath } from 'vite'
import { stringify } from 'javascript-stringify'

// import { Visitor } from '@swc/core/Visitor'
// import type * as swc from '@swc/core'

export type VitePluginToadOptions = {
   include?: FilterPattern
   exclude?: FilterPattern
   /**
    * Tag to replace.
    * @default 'css'
    */
   tag?: string
   /**
    * Tag to replace.
    * @default 'css'
    */
   outputExtension?: string

   ssr: {
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
      ): Rollup.TransformResult | Promise<Rollup.TransformResult>
   }
   /**
    * Transform or process style of each module
    */
   transformStyle?(server: ViteDevServer, collectedSource: string): string | Promise<string>
}
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
   let config: ResolvedConfig
   let server: ViteDevServer
   let root: string
   let env: ConfigEnv

   let lastServedTime = Date.now()

   const VIRTUAL_MODULE_PREFIX = '/@toad/virtual'
   const WS_EVENT_PREFIX = '@toad:hmr'
   const TODAD_IDENTIFIER = '__TOAD__'
   const QS_SSR = 'toad-ssr'
   const QS_FULL_SKIP = 'toad-full-skip'
   const STYLE_HASH_LEN = 8

   type VirtualModuleData = {
      hash: string
      src: string
      ownerId: string
      deps: string[]
   }
   const state: {
      [id: string]: VirtualModuleData
   } = {}

   const filter = createFilter(options.include, options.exclude)
   const rootAbs = (p: string) => path.resolve(root, p)
   const rootRel = (p: string) => path.relative(root, p)
   const comparePaths = (p1: string, p2: string) => {
      p1 = path.normalize(p1)
      p2 = path.normalize(p2)
      if (!path.isAbsolute(p1)) p1 = rootAbs(p1)
      if (!path.isAbsolute(p2)) p2 = rootAbs(p2)
      return p1 === p2
   }
   const prettifyPath = (p: string) => {
      if (path.isAbsolute(p)) p = rootRel(p)
      return '/' + normalizePath(p)
   }
   function createHash(data, len) {
      return crypto.createHash('shake256', { outputLength: len }).update(data).digest('hex')
   }

   const jsRegex = new RegExp(`(${options.tag})\\s*\`([\\s\\S]*?)\``, 'gm')
   // const jsxRegex = new RegExp(`(${options.tag})\\s*\`([\\s\\S]*?)\``, 'gm')

   // class ToadVisitor extends Visitor {
   //    visitModule(m: swc.Module): swc.Module {
   //       return super.visitModule(m)
   //    }
   //    visitIdentifier(node) {
   //       return node
   //    }

   //    visitTsType(node) {
   //       return node
   //    }
   // }

   function getToadModuleId(modId: string) {
      return path.posix.join(
         VIRTUAL_MODULE_PREFIX,
         modId.replace(path.extname(modId), options.outputExtension)
      )
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
      const transformed = code.replaceAll(jsRegex, (substring, tag, src) => {
         src = src.trim()

         const filename = relId.replace(path.extname(relId), '')
         const isGlobal = src.startsWith('/*global*/')

         let classId = filename
         if (isGlobal) {
            classId += '-global-'
         }
         classId += createHash(src, 5)
         classId = toValidCSSIdentifier(classId)
         entries.push({ classId, src, isGlobal })

         return isGlobal ? '' : `"${classId}"`
      })
      return [transformed, entries] as const
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
         env = _env
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

         const [processedCode, entries] = processModule(id, code)
         if (entries.length == 0) return code

         const vModId = getToadModuleId(id)

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
               if (isGlobal) {
                  state[vModId].src += `${src}\n`
                  continue
               }
               state[vModId].src += `.${classId} {${src}}\n`
            }
            state[vModId].hash = createHash(state[vModId].src, STYLE_HASH_LEN)
         }

         if (!options.ssr?.eval) {
            await createStyle(vModId, entries)
            return result
         }

         const mod = await server.ssrLoadModule(id + '?' + QS_SSR, { fixStacktrace: true })
         const evaluatedEntries = mod[TODAD_IDENTIFIER] as StyleEntry[]
         await createStyle(vModId, evaluatedEntries)

         const res = await server.ssrTransform(code, null, id)
         for (const dep of res.deps) {
            const resolved = await this.resolve(dep, id)
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
         // it's module, so just transform it
         const mods = ctx.modules.filter(mod => !mod.id.includes(QS_SSR))
         // if (!ctx.modules.length) return ctx.modules
         // cond
         for (const mod of mods) {
            server.moduleGraph.invalidateModule(mod)
            const toadMod = server.moduleGraph.getModuleById(getToadModuleId(mod.id))
            if (toadMod) {
               server.moduleGraph.invalidateModule(toadMod)
            }
         }
         return mods
      },
   }

   const ssr: Plugin = {
      name: 'toad:ssr',
      enforce: 'pre',

      transform: {
         order: 'pre',
         async handler(code, url, opts) {
            const [id, qs] = url.split('?')
            if (!filter(id)) return

            if (qs?.includes(QS_FULL_SKIP)) return
            if (!opts?.ssr || !qs?.includes(QS_SSR)) return

            const [processedCode, entries] = processModule(id, code)

            const vModId = getToadModuleId(id)
            const jsEntries = stringify(entries, (value, space, next, key) => {
               if (typeof value === 'string') {
                  return `\`${value}\``
               }
               return next(value)
            })
            let moduleCode = processedCode
            if (options.ssr?.customSSRTransformer) {
               try {
                  const result = await options.ssr?.customSSRTransformer(
                     processedCode,
                     this,
                     server,
                     code,
                     url,
                     opts
                  )
                  if (result) {
                     moduleCode = typeof result == 'string' ? result : result.code
                  } else config.logger.warn('[toad] customSSRTransformer did not return a value')
               } catch (e) {
                  config.logger.error('[toad] Failed to transform using custom transformer', { error: e })
               }
            }
            return `
               ${moduleCode}
               export const ${TODAD_IDENTIFIER} = ${jsEntries}
            `
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
   if (options.ssr?.customSSRTransformer) plugins.push(ssr)

   return Object.assign(plugins, { name: 'toad' })
}

export { css, skipToadForUrl } from './helpers.ts'
