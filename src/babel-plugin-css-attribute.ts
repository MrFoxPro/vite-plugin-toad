import type * as babel from "@babel/core"

type BabelPluginCSSAttributeOptions = {
   attribute?: string
}

export default ({ types }: typeof babel, options: BabelPluginCSSAttributeOptions) => {
   options = Object.assign(
      {
         attribute: "css"
      },
      options
   )
   return {
      visitor: {
         JSXElement(path, state) {
            path.traverse({
               JSXOpeningElement(path, state) {
                  const attributes = path.node.attributes.filter(
                     (x) => x.type === "JSXAttribute"
                  ) as babel.types.JSXAttribute[]
                  const classAttr = attributes.find((attr) => attr.name.name === "class")
                  if (
                     classAttr &&
                     classAttr.value?.type !== "JSXExpressionContainer" &&
                     classAttr.value?.type !== "StringLiteral"
                  ) {
                     console.warn(
                        "Unsupported `class` attribute type",
                        classAttr.value?.type,
                        "to replace with",
                        options.attribute,
                        "attribute"
                     )
                     return
                  }

                  let targetValue: string

                  for (const node of attributes) {
                     // some weird attribute
                     if (!node.value) continue

                     // attribute has different name
                     if (node.name.name !== options.attribute) continue

                     if (node.value.type === "StringLiteral") {
                        targetValue = node.value.value
                     } else if (
                        node.value.type === "JSXExpressionContainer" &&
                        node.value.expression.type === "StringLiteral"
                     ) {
                        targetValue = node.value.expression.value
                     }

                     if (!targetValue) {
                        console.warn(node.value.type, "is not supported for", options.attribute, "attribute")
                     }
                     break
                  }

                  if (!targetValue) return

                  if (!classAttr) {
                     const newAttr = types.jsxAttribute(
                        types.jsxIdentifier("class"),
                        types.stringLiteral(targetValue)
                     )
                     path.node.attributes.push(newAttr)
                     return
                  }

                  const left = classAttr.value
                  const right = types.stringLiteral(" " + targetValue)
                  // @ts-ignore
                  const newExpression = types.jsxExpressionContainer(types.binaryExpression("+", left, right))
                  classAttr.value = newExpression
               }
            })
         }
      }
   } satisfies babel.PluginObj
}
