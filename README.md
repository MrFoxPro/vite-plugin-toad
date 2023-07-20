# 🌺🐸☘️

Zero-runtime CSS-in-JS tool inspired by Linaria.

Try on [StackBlitz](https://stackblitz.com/edit/solidjs-templates-lmpush?file=app%2Fapp.tsx) or check out [example](example-solid).

⚠ Work in progress.

`pnpm i -D vite-plugin-toad`

```tsx
/*@toad-ext .scss*/ // This sets extension for corresponding output file.
// You can set in plugin config globally or for each file.
import { render } from 'solid-js/web';
import { modularScale, hiDPI } from 'polished';
import { css } from 'vite-plugin-toad/css';
import Constants from './constants';
import logo from './logo.svg';

css`/*global*/ /* mark style as global */
   body {background-color: ${Constants.BACKGROUND_COLOR};} /* Use some static variables. Works when 'ssr.evaluate = true' */
   @keyframes logo-spin {
      from {transform: rotate(0deg);}
      to {transform: rotate(360deg);}
   }
`;
const App = () => (
   <div
      class={css`
        /*@toad-debug wrapper*/ // <- this adds "wrapper" to output class
        max-width: 800px;
        background-color: #dadada;
        font-size: ${modularScale(2)};
        ${hiDPI(1.5)} {
          font-size: ${modularScale(2.5)};
        }
      `}
   >
      <img
         src={logo}
         class={css`
          animation: logo-spin infinite 10s linear;
          height: 40vmin;
          pointer-events: none;
          & ~ p {
              $variable: blue;
              color: #{$variable}; // This code will work as we set .scss extension
          }
        `}
      />
      <p>Edit <code>app.tsx</code> and save to reload</p>
      <a href="https://github.com/solidjs/solid" target="_blank" > Learn solid </a>
   </div>
);
if (!import.meta.env.SSR) {
   render(App, document.body);
}
```
All CSS transforms are handled by Vite, so it will work with SASS, LightningCSS, PostCSS and other tools.  
For more advanced documentation, please refer to typescript JSDoc comments.

# Motivation
I found following way of writing components can be convinient:
```tsx
<TextField.Input
   ref={numberInputRef}
   inputmode="decimal"
   css="
      background-color: var(--grey-000);
      border: 1px solid blue; border-radius: 8px;
      &:focus {
         outline-offset: -5px; outline-color: var(--grey-000);
      }
      color: var(--black-900); line-height: 3.5rem; font-weight: 500;
   "
   h-12 w-full p-l-10px
/>
```
CSS-in-JS for creating component styles, and Atomic CSS with attributify for positioning component in layout.  
I found this way keeps code more clean and readable. It avoids mess of long atomic classes with `?#[]@` symbols and decoupling of styles as it used to with BEM or CSS modules.

I'm planning to add handling of `css=""` attribute.

# Known tradeoffs
Make sure you modules with CSS-in-JS don't use top-level DOM API if you are using `ssr: { eval: true }`. You can wrap it like in the example:
```ts
if (!import.meta.env.SSR) {
   render(App, document.body)
}
```
---
Some [plugins](https://github.com/solidjs/vite-plugin-solid/pull/105) don't respect Vite `ssr: true` option when using `ssrLoadModule`, so they need to be processed separately if you're want to use variables in template literals.  
You can process it in `customSSRTransformer`. Make sure to output SSR-ready code.
```ts
ViteToad({
   ssr: {
      eval: true,
      async customSSRTransformer(code, ctx, server, _c, url) {
         solidOptions.solid.generate = 'ssr'
         const result = await server.transformRequest(skipToadForUrl(url), { ssr: true })
         return {
            result,
            // this will be called when we will transform all dependencies
            cb: () => {
               solidOptions.solid.generate = 'dom'
            }
         } 
      },
   },
})
```
Currently, it may not work if styles are co-located with some legacy dependencies / or dependencies that are not intended to be used in SSR environment. What you can do about it:
- Split your code so your component with styles are not in the same module with bad dependency
- Wrap your dependency in lazy `import()` inside your component near usage place, or in `if(!import.meta.env.SSR)`.
- Try another SSR-friendly library instead
- Make a simple Vite plugin just in your configuration to skip dependency: return empty string in Vite `load()` hook.
- Play with Vite `ssr.external` configuration.
It's possible that I will implement some kind of tree-shaking through SWC, so all unused in styling deps will be omitted, as Linaria do with their shaker.