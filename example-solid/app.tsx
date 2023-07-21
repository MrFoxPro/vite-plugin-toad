/*@toad-ext .scss*/ // This sets extension for corresponding output file.
// You can set in plugin config globally or for each file.
import { render } from 'solid-js/web';
import { modularScale, hiDPI } from 'polished';
import { css } from '../src/css';
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
         max-width: 400px;
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