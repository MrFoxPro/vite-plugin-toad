type CSS = (strings: TemplateStringsArray, ...exprs: Array<string | number>) => string
export const css: CSS = () => void 0

declare global {
    export const css: CSS 
}