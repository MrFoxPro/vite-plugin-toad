type CSS = (strings: TemplateStringsArray, ...exprs: Array<string | number>) => string
export const css: CSS = () => void 0

export const createToadSelect = <T extends string>(name: T) => {
    return {
        [name]: css
    } as Record<T, CSS>
}
