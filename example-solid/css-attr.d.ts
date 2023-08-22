import "solid-js/jsx-runtime"

declare module "solid-js" {
   namespace JSX {
      interface HTMLAttributes<T> {
         css?: string
      }
   }
}
