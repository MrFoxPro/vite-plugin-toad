/*@toad-ext .scss*/
// This sets extension for corresponding output file.
// You can set in plugin config globally or for each file.
import { render } from "solid-js/web"
import { hiDPI, modularScale } from "polished"

import { css } from "../src/css.js"
import Constants from "./dep1.js"

import LogoIcon from "#logo.svg"

css`
   /*global*/ /* mark style as global */
   body {
   } /* Use some static variables. Works when 'ssr.evaluate = true' */
   @keyframes logo-spin {
      from {
         transform: rotate(0deg);
      }
      to {
         transform: rotate(360deg);
      }
   }
`
function App() {
   return (
      <div
         css={css`
            max-width: 400px;
            background-color: orange;
         `}
      >
         <LogoIcon
            class={css`
               animation: logo-spin infinite 10s linear;
               height: 20vmin;
               pointer-events: none;
               & ~ p {
                  $variable: blue;
                  color: #{$variable}; // This code will work as we set .scss extension
               }
            `}
         />
         <p
            class={
               "a" +
               "b" +
               (function () {
                  return "hi"
               })()
            }
            css={css`
               color: royalblue;
            `}
         >
            Edit <code>app.tsx</code> and save to reload
         </p>
         <a href="https://github.com/solidjs/solid" target="_blank" css={"fadsf"}>
            Learn solid
         </a>
      </div>
   )
}
if (!import.meta.env.SSR) {
   render(App, document.body)
}
