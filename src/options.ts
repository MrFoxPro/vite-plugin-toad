import type { FilterPattern } from "vite"
import type { TransformOptions } from "@babel/core"

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
   customAttribute?: {
      enable: boolean
      name: string
   }
   babelOptions?: TransformOptions
   ssr?: {
      /**
       * Load module to evaluate emplate strings
       * @default false
       */
      eval?: boolean
      /**
       * If you have plugins doesn't respect vite `ssr` argument when transforming code like Solid does:
       * https://github.com/solidjs/vite-plugin-solid/pull/105
       * You can provide additional options to transform module for SSR mode.
       * @default null
       */
      babelOptions?: TransformOptions
   }
   mode?: 'regex' | 'babel';
   createClassName?(ctx: { filename: string; isGlobal: boolean; debugName: string; hash: string }): string
   createStyle?(className: string, template: string, isGlobal: boolean): string
}
