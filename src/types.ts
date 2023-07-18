type CSS = (strings: TemplateStringsArray, ...exprs: Array<string | number>) => string
export const css: CSS = (strings: TemplateStringsArray, ...exprs: Array<string | number>) => strings[0]
