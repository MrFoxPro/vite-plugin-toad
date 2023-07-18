Zero-runtime CSS-in-JS tool.

HMR supported.

```tsx
/*@toad-ext .scss*/ // This sets extension for corresponding output extension.
// You can set in plugin config globally or for each file.

import Constants from './constants.ts'
css`
   /*global*/ // this mark style as global
   body { background-color: ${Constants.BACKGROUND_COLOR}; } // Use some static variables. Works when `ssr.evaluate = true` in plugin settings
   @keyframes logo-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
   }
`
const App = () => {
   return (
      <div
         class={css`
            /*@toad-debug wrapper*/  /* <- this adds "wrapper to output class" */
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
            <p> Edit <code>app.tsx</code> and save to reload. </p>
            <a href="https://github.com/solidjs/solid" target="_blank">Learn solid</a>
         </header>
      </div>
   )
}
```
For more advanced documentation, read typescript JSDoc comments.

Check out [example](example-solid)
⚠ Work in progress.
