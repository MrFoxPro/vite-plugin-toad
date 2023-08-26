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
      name: "jsx-css-attribute",
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

                  let targetExpr: babel.types.StringLiteral | babel.types.Expression

                  for (const node of attributes) {
                     // some weird attribute
                     if (!node.value) continue

                     // attribute has different name
                     if (node.name.name !== options.attribute) continue

                     if (t.isStringLiteral(node.value)) {
                        targetExpr = node.value
                     } else if (t.isJSXExpressionContainer(node.value)) {
                        if (
                           t.isStringLiteral(node.value.expression) ||
                           t.isTaggedTemplateExpression(node.value.expression)
                        ) {
                           targetExpr = node.value.expression
                        }
                     }

                     if (!targetExpr) {
                        console.warn(node.value.type, "is not supported for", options.attribute, "attribute")
                     }
                     break
                  }

                  if (!targetExpr) return

                  if (!classAttr) {
                     const newAttr = t.jsxAttribute(t.jsxIdentifier("class"), t.jsxExpressionContainer(targetExpr))
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
                  } else {
                     console.warn("Your", classAttr.name.name, "attribute is malformed")
                     return
                  }
                  left = t.parenthesizedExpression(left)

                  const leftWithSpace = t.binaryExpression("+", left, t.stringLiteral(" "))
                  const newExpression = t.jsxExpressionContainer(t.binaryExpression("+", leftWithSpace, targetExpr))
                  classAttr.value = newExpression
               }
            })
         }
      }
   } satisfies babel.PluginObj
}
