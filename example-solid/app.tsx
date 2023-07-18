import { render } from 'solid-js/web'

import { css } from '../src/types.ts'
import logo from './app/logo.svg'
// import Constants from './app/constants.js'

css`
   /*global*/
   body {
      background-color: red;
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
      background-color: green;
   `
   return (
      <div class={cl}>
         <header>
            <img src={logo} />
            <p
               class={css`
                  color: green;
               `}
            >
               Edit <code>src/Appasadsfasgsfgasdasfasdfddfgsad.tsx</code> and save to reload.
            </p>
            <a href="https://github.com/solidjs/solid" target="_blank" rel="noopener noreferrer">
               Learn sfdasdfasasdfdsgfasdsaasfdsfsafgadsfsdf
            </a>
         </header>
      </div>
   )
}

render(App, document.body)
