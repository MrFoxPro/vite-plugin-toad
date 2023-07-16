import { isServer, render } from 'solid-js/web'

import { css } from '../../src/types.js'
import logo from './logo.svg'
import Constants from './constants.ts'

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
   const cl = css`
      color: white;
   `
   return (
      <div class={cl} css="text-align: center;">
         <header
            css="
               background-color: #282c34;
               min-height: 100vh;
               display: flex;
               flex-direction: column;
               align-items: center;
               justify-content: center;
               font-size: calc(10px + 2vmin);
               color: white;
            "
         >
            <img
               src={logo}
               css="
                  animation: logo-spin infinite 20s linear;
                  height: 40vmin;
                  pointer-events: none;
               "
            />
            <p>
               Edit <code>src/App.tsx</code> and save to reload.
            </p>
            <a
               css="
                  color: #b318f0;
               "
               href="https://github.com/solidjs/solid"
               target="_blank"
               rel="noopener noreferrer"
            >
               Learn sfdasdfasgfsafgadsfsdf
            </a>
         </header>
      </div>
   )
}
if (!isServer) {
   render(App, document.body)
}
