/*@toad-ext .css*/

import { isServer, render } from 'solid-js/web'

import { css } from '../../src/types.js'
import Constants from './constants.ts'
import logo from './app/logo.svg'

css`
   /*global*/
   body {
      background-color: ${Constants.BACKGROUND_COLOR};
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
   return (
      <div
         class={css`
            /*@toad-debug wrapper*/
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
                     color: blue; // SCSS!
                  }
               `}
            />
            <p>
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
