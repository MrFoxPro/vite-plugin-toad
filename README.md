This plugin allows to configure rendering of certain pages in SSG, in SSG + JS mode and serve them on specific paths.
If you're familiar with vite-plugin-ssr, it's simple replacement for it.


`pnpm i -D vite-plugin-universal`

Example configuration:
```ts
ViteUniversalPlugin<{ head: string[]; body: string[] }>({
  entries: [
      {
        ssrEntry: 'blog/blog.tsx',
        templatePath: 'blog/blog.html',
        urlAlias: '/blog',
        outputPath: 'blog.html',
      },
      {
        ssrEntry: 'civet/entry.civet',
        templatePath: 'civet/civet.html',
        outputPath: 'nested/civet.html',
      },
      {
        templatePath: 'app/app.html',
        urlAlias: '/',
        outputPath: 'index.html',
        isFallback: true,
      },
  ],
  applyOutput({ head, body }, template) {
      return template.replace('<!--head-->', head.join('\n')).replace('<!--body-->', body.join('\n'))
  },
}),
```
Will produce following build output:
```
dist
 ┣ assets
 ┃ ┣ app.css
 ┃ ┣ logo.svg
 ┃ ┗ web.js
 ┣ nested
 ┃ ┗ civet.html
 ┣ app.js
 ┣ blog.html
 ┣ civet.js
 ┗ index.html
```
Check out example to see how it works.

⚠ Make sure to specify absolute paths to assets and modules in your html templates and ensure you have `base: '/'` in your Vite configuration.

Custom SSR entry transforming:
```ts
async ssrEntryTransformHook(ctx, server, entry, code, id, options) {
    // We can do simple hack
    solidOptions.solid.generate = 'ssr'
    solidOptions.solid.hydratable = false
    const result = await server.transformRequest(id, { ssr: true })
    solidOptions.solid.generate = 'dom'
    return result

    // Or completely transform code as we need.
    const solidPlugin = server.config.plugins.find(plugin => plugin.name == 'solid')
    if (typeof solidPlugin.transform === 'function') {
      // Here we can customize transformation of our SSR entry
      const transformed = await solidPlugin.transform.call(this, code, id, options)
      return transformed
    }
},
```
