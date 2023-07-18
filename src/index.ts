import * as path from 'node:path'
import * as crypto from 'node:crypto'

import type {
   Plugin,
   ResolvedConfig,
   FilterPattern,
   ViteDevServer,
   ModuleNode,
   Update,
   UserConfig,
   ConfigEnv,
} from 'vite'
import { createFilter, createServer, mergeConfig, normalizePath } from 'vite'
import outdent from 'outdent'
import { stringify } from 'javascript-stringify'
// import { Visitor } from '@swc/core/Visitor'
// import type * as swc from '@swc/core'

export type VitePluginToadOptions = {
   include?: FilterPattern
   exclude?: FilterPattern
   /**
    * Tag to replace. Default is `css`
    */
   tag?: string
   /**
    * Tag to replace. Default is `.css`
    */
   outputExtension?: string
   eval?: boolean
}
export default function (
   options: VitePluginToadOptions = {
      include: [/\.(t|j)sx?/],
      exclude: [/node_modules/],
      tag: 'css',
      outputExtension: '.css',
   }
): Plugin {
   let config: ResolvedConfig
   let server: ViteDevServer
   let root: string
   let env: ConfigEnv

   let lastServedTime = Date.now()

   const VIRTUAL_MODULE_PREFIX = '/@toad/virtual'
   const WS_EVENT_PREFIX = '@toad:hmr'
   const TODAD_IDENTIFIER = '__TOAD__'
   const SSR_QS = 'ssr-toad'

   const state: {
      [id: string]: {
         hash: string
         src: string
         ownerId: string
         dependencies: string[]
      }
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

   return {
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
            console.log('sending hmr update')
            if (state[id]?.hash != hash) sendHmrUpdate(Object.keys(state))
         })
      },
      resolveId(id) {
         if (id.startsWith(VIRTUAL_MODULE_PREFIX)) {
            return id
         }
      },
      load(url) {
         const [id, qs] = url.split('?')
         if (!id.startsWith(VIRTUAL_MODULE_PREFIX)) return
         const source = state[id]
         if (!source) {
            if (qs?.includes(SSR_QS)) return ''

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
            server: {
               middlewareMode: true,
            },
            appType: 'custom',
         })
         return
      },
      async transform(code, url, opts) {
         const [id, qs] = url.split('?')
         if (!filter(id)) return null

         type Entry = {
            classId: string
            src: string
            isGlobal: boolean
         }
         const data = {
            entries: [] as Entry[],
         }

         const relId = rootRel(id)
         const transformed = code.replaceAll(jsRegex, (substring, ...args) => {
            const tag: string = args[0]
            const src: string = args[1].trim()

            const isGlobal = src.startsWith('/*global*/')

            let classId = relId.replace(path.extname(relId), '')
            classId = classId.replaceAll('/', '-')
            if (isGlobal) classId += '-global-'
            classId += createHash(src, 5)
            data.entries.push({
               classId,
               src,
               isGlobal,
            })
            if (isGlobal) return ''
            return '"' + classId + '"'
         })

         if (data.entries.length == 0) return code

         let outro = ''
         if (!opts?.ssr && code.includes('import.meta.hot')) {
            const vMod = Object.entries(state).find(([_vId, data]) => data.ownerId === id)
            if (vMod) {
               outro += `
               if (import.meta.hot) {
                  try { await import.meta.hot.send('${WS_EVENT_PREFIX}', ["${id}", "${vMod[1].hash}"]); }
                  catch (e) { console.warn('${WS_EVENT_PREFIX}', e) }
                  if (!import.meta.url.includes('?')) await new Promise(resolve => setTimeout(resolve, 100))
               }
            `
            }
         }
         const vModId = getToadModuleId(id)

         if (qs?.includes(SSR_QS)) {
            const exportsCode =
               `export const ${TODAD_IDENTIFIER} = ` +
               stringify(data, (value, space, next, key) => {
                  if (typeof value === 'string') {
                     return `\`${value}\``
                  }
                  return next(value)
               })
            return outdent`
                  import "${vModId}?${SSR_QS}"
                  ${transformed}
                  ${exportsCode}
               `
         }
         state[vModId] = {
            src: '',
            hash: null,
            ownerId: id,
            dependencies: [],
         }
         let items = data.entries
         if (options.eval) {
            const mod = await server.ssrLoadModule(id)
            items = mod[TODAD_IDENTIFIER].entries as Entry[]
         }
         for (const { classId, src, isGlobal } of items) {
            if (isGlobal) {
               state[vModId].src += `${src}\n`
               continue
            }
            state[vModId].src += `.${classId} {${src}}\n`
         }
         state[vModId].hash = createHash(state[vModId].src, 8)
         if (!options.eval) {
            return outdent`
               import "${vModId}"
               ${transformed}
               ${outro}
            `
         }
         const res = await server.ssrTransform(code, null, id)
         for (const dep of res.deps) {
            const resolved = await this.resolve(dep, id)
            const modInfo = this.getModuleInfo(resolved.id)
            if (modInfo && !modInfo.id.includes('node_modules')) state[vModId].dependencies.push(modInfo.id)
         }
         // const vMod = server.moduleGraph.getModuleById(vModId)
         // if (vMod) {
         //    server.moduleGraph.invalidateModule(vMod)
         //    vMod.lastHMRTimestamp = vMod.lastInvalidationTimestamp || Date.now()
         // }
         return outdent`
               import "${vModId}"
               ${transformed}
               ${outro}
            `
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
         const mods = ctx.modules.filter(mod => !mod.id.includes(SSR_QS))
         // if (!ctx.modules.length) return ctx.modules
         // cond
         for (const mod of mods) {
            const toadMod = server.moduleGraph.getModuleById(getToadModuleId(mod.id))
            server.moduleGraph.invalidateModule(toadMod)
            server.moduleGraph.invalidateModule(mod)
         }
         return mods

         // // Select affected modules of changed dependency
         // const affected = Object.entries(state).filter(
         //    ([id, x]) =>
         //       // file is dependency of any target
         //       x.dependencies.some(dep => dep === ctx.file) ||
         //       // or changed module is a dependency of any target
         //       x.dependencies.some(dep => ctx.modules.some(m => m.file === dep))
         // )
         // const modules = affected
         //    .map(([id]) => server.moduleGraph.getModuleById(id))
         //    .concat(ctx.modules)
         //    .filter((m): m is ModuleNode => !!m)
         // // modules.forEach(m => server.moduleGraph.invalidateModule(m))
         // return modules
         // return []
      },
   }
}
export { css } from './helpers.ts'
