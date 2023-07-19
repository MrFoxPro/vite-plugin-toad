Zero-runtime CSS-in-JS tool.
⚠ Work in progress.

HMR supported.

`pnpm i -D vite-plugin-toad`

Try on [StackBlitz](https://stackblitz.com/edit/solidjs-templates-lmpush?file=app%2Fapp.tsx) or check out [example](example-solid).

```tsx
/*@toad-ext .scss*/ // This sets extension for corresponding output file.
// You can set in plugin config globally or for each file.
import { css } from 'vite-plugin-toad/css'
import Constants from './constants.ts'
css`
   /*global*/ // this mark style as global
   body { background-color: ${Constants.BACKGROUND_COLOR}; } // Use some static variables. Works when `ssr.evaluate = true` in plugin settings
   @keyframes logo-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
   }
`
const App = () => (
   <div
      class={css`
         /*@toad-debug wrapper*/  // <- this adds "wrapper" to output class
         max-width: 800px;
         background-color: #dadada;
      `}
   >
      <header>
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
         <p> Edit <code>app.tsx</code> and save to reload.</p>
         <a href="https://github.com/solidjs/solid" target="_blank">Learn solid</a>
      </header>
   </div>
)
```
For more advanced documentation, read typescript JSDoc comments.

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
