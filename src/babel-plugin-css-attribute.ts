import type * as babel from "@babel/core"

type BabelPluginCSSAttributeOptions = {
   attribute?: string
}

export default ({ types: t }: typeof babel, options: BabelPluginCSSAttributeOptions) => {
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
                  const attributes = path.node.attributes.filter((attr) =>
                     t.isJSXAttribute(attr)
                  ) as babel.types.JSXAttribute[]
                  const classAttr = attributes.find((attr) => attr.name.name === "class")
                  if (
                     classAttr &&
                     !t.isJSXExpressionContainer(classAttr.value) &&
                     !t.isStringLiteral(classAttr.value)
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

                     if (t.isStringLiteral(node.value)) {
                        targetValue = node.value.value
                     } else if (
                        t.isJSXExpressionContainer(node.value) &&
                        t.isStringLiteral(node.value.expression)
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
                     const newAttr = t.jsxAttribute(t.jsxIdentifier("class"), t.stringLiteral(targetValue))
                     path.node.attributes.push(newAttr)
                     return
                  }

                  let left: babel.types.Expression

                  if (t.isJSXExpressionContainer(classAttr.value)) {
                     if (t.isJSXEmptyExpression(classAttr.value.expression)) {
                        console.warn("Your", classAttr.name.name, "is malformed")
                        return
                     }
                     left = classAttr.value.expression
                  } else if (t.isStringLiteral(classAttr.value)) {
                     left = classAttr.value
                  }
                  else {
                     console.warn("Your", classAttr.name.name, "attribute is malformed")
                     return
                  }
                  left = t.parenthesizedExpression(left)
                  const right = t.stringLiteral(" " + targetValue)
                  const newExpression = t.jsxExpressionContainer(t.binaryExpression("+", left, right))
                  classAttr.value = newExpression
               }
            })
         }
      }
   } satisfies babel.PluginObj
}
