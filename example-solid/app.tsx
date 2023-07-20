/*@toad-ext .scss*/

import { isServer, render } from 'solid-js/web'

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

import { css } from '../src/css'
import logo from './logo.svg'
import Constants from './constants.ts'
import { Button, TextField } from '@kobalte/core'
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
                     $variable: blue;
                     color: #{$variable}; // SCSS!
                  }
               `}
            />
            <TextField.Root>
               <TextField.Input
                  inputmode='decimal'
                  class={css`
                     background-color: var(--grey-000);
                     border: 1px solid blue;
                     border-radius: 8px;
                     &:focus {
                        outline-offset: -5px;
                        outline-color: var(--grey-000);
                     }
                     line-height: 3.5rem;
                     color: var(--black-900);
                     font-weight: 500;
                  `}
               />
            </TextField.Root>
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
if (!import.meta.env.SSR) {
   render(App, document.body)
}
