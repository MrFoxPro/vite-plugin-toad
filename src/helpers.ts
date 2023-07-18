type CSS = (strings: TemplateStringsArray, ...exprs: Array<string | number>) => string
export const css: CSS = () => void 0

export function skipToadForUrl(url: string) {
   return url.includes('?') ? url + '&toad-full-skip' : url + '?toad-full-skip'
}
