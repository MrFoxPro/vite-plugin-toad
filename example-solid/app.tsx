import { isServer, render } from 'solid-js/web'

import { css } from '../src/types.ts'
import logo from './app/logo.svg'
// import Constants from './app/constants.js'

css`
   /*global*/
   body {
      background-color: blue;
   }
   @keyframes logo-spin {
      from {
         transform: rotate(0deg);
      }
      to {
         transform: rotate(360deg);
      }
   }
`
const App = () => {
   const cl = css`
      max-width: 800px;
      background-color: #dadada;
   `
   return (
      <div class={cl}>
         <header>
            <img
               src={logo}
               class={css`
                  animation: logo-spin infinite 10s linear;
                  height: 40vmin;
                  pointer-events: none;
               `}
            />
            <p
               class={css`
                  color: blue;
               `}
            >
               Edit <code>app.tsx</code> and save to reload.
            </p>
            <a href="https://github.com/solidjs/solid" target="_blank" rel="noopener noreferrer">
               Learn solid
            </a>
         </header>
      </div>
   )
}
if (!isServer) {
   render(App, document.body)
}
