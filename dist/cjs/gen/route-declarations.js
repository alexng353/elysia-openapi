"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/gen/route-declarations.ts
var route_declarations_exports = {};
__export(route_declarations_exports, {
  extractRouteDeclarations: () => extractRouteDeclarations,
  flattenNestedIntersections: () => flattenNestedIntersections,
  normalizeGeneratedSchema: () => normalizeGeneratedSchema,
  prepareTypeForParser: () => prepareTypeForParser
});
module.exports = __toCommonJS(route_declarations_exports);

// src/gen/typescript.ts
var import_typescript = require("#typescript");

// src/gen/route-declarations.ts
var methods = /* @__PURE__ */ new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
  "connect",
  "all",
  "subscribe"
]);
function propertyName(name) {
  const ts = (0, import_typescript.getTypeScript)();
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression)))
    return name.expression.text;
}
function hasCompleteMetadata(type) {
  const ts = (0, import_typescript.getTypeScript)();
  const fields = /* @__PURE__ */ new Set();
  const collect = (node) => {
    if (ts.isParenthesizedTypeNode(node)) collect(node.type);
    else if (ts.isIntersectionTypeNode(node)) node.types.forEach(collect);
    else if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members)
        if (ts.isPropertySignature(member))
          fields.add(propertyName(member.name) ?? "");
    }
  };
  collect(type);
  return ["body", "params", "query", "headers", "response"].every(
    (field) => fields.has(field)
  );
}
function containsCompleteRoute(node) {
  const ts = (0, import_typescript.getTypeScript)();
  if (ts.isPropertySignature(node) && node.type && methods.has(propertyName(node.name)?.toLowerCase() ?? "") && hasCompleteMetadata(node.type))
    return true;
  return ts.forEachChild(
    node,
    (child) => containsCompleteRoute(child) || void 0
  ) ?? false;
}
function hasResponse(type) {
  const ts = (0, import_typescript.getTypeScript)();
  if (hasCompleteMetadata(type)) return true;
  if (ts.isParenthesizedTypeNode(type)) return hasResponse(type.type);
  if (ts.isIntersectionTypeNode(type)) return type.types.some(hasResponse);
  return ts.isTypeLiteralNode(type) && type.members.some(
    (member) => ts.isPropertySignature(member) && propertyName(member.name) === "response" && member.type && !containsCompleteRoute(member.type) && (!ts.isTypeLiteralNode(member.type) || member.type.members.every(
      (status) => ts.isIndexSignatureDeclaration(status) || ts.isPropertySignature(status) && /^(?:\d+|default)$/.test(
        propertyName(status.name) ?? ""
      )
    ))
  );
}
function extractRouteDeclarations(declaration) {
  const ts = (0, import_typescript.getTypeScript)();
  const source = ts.createSourceFile(
    "routes.d.ts",
    `type Routes = ${declaration}`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const statement = source.statements[0];
  if (!statement || !ts.isTypeAliasDeclaration(statement)) return [];
  const routes = [];
  const visit = (node, path) => {
    if (ts.isParenthesizedTypeNode(node)) return visit(node.type, path);
    if (ts.isIntersectionTypeNode(node)) {
      for (const member of node.types) visit(member, path);
      return;
    }
    if (!ts.isTypeLiteralNode(node)) return;
    for (const member of node.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const name = propertyName(member.name);
      if (name === void 0) continue;
      if (methods.has(name.toLowerCase()) && hasResponse(member.type)) {
        routes.push({
          path,
          method: name.toLowerCase(),
          type: member.type.getText(source)
        });
      } else {
        visit(member.type, [...path, name]);
      }
    }
  };
  visit(statement.type, []);
  return routes;
}
function flattenNestedIntersections(declaration) {
  return extractRouteDeclarations(declaration).map(({ path, method, type }) => {
    let result = `{ ${JSON.stringify(method)}: ${type} }`;
    for (let index = path.length - 1; index >= 0; index--)
      result = `{ ${JSON.stringify(path[index])}: ${result} }`;
    return result;
  }).join(" & ");
}
function normalizeGeneratedSchema(schema, onUnresolved) {
  if (schema.patternProperties && Object.keys(schema.patternProperties).length === 1 && "^(.*)$" in schema.patternProperties) {
    schema.additionalProperties = schema.patternProperties["^(.*)$"];
    delete schema.patternProperties;
    schema.properties ??= {};
    schema[/* @__PURE__ */ Symbol.for("TypeBox.Kind")] = "Object";
  }
  if (typeof schema.$ref === "string" && !schema.$ref.startsWith("#/")) {
    onUnresolved(schema.$ref);
    delete schema.$ref;
    schema[/* @__PURE__ */ Symbol.for("TypeBox.Kind")] = "Unknown";
  }
  if (schema.type === "Date") {
    schema.type = "string";
    schema.format = "date-time";
    schema[/* @__PURE__ */ Symbol.for("TypeBox.Kind")] = "String";
  }
  if (typeof schema.type === "string" && ![
    "string",
    "number",
    "integer",
    "boolean",
    "object",
    "array",
    "null"
  ].includes(schema.type)) {
    onUnresolved(schema.type);
    for (const key of Reflect.ownKeys(schema)) delete schema[key];
    schema[/* @__PURE__ */ Symbol.for("TypeBox.Kind")] = "Unknown";
    return;
  }
  for (const value of Object.values(schema)) {
    if (value && typeof value === "object")
      normalizeGeneratedSchema(value, onUnresolved);
  }
}
var genericTypes = /* @__PURE__ */ new Set([
  "Array",
  "Record",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "Awaited",
  "Promise",
  "Uppercase",
  "Lowercase",
  "Capitalize",
  "Uncapitalize"
]);
function prepareTypeForParser(type, onUnresolved) {
  const ts = (0, import_typescript.getTypeScript)();
  const source = ts.createSourceFile(
    "schema.ts",
    `type Schema = ${type}`,
    ts.ScriptTarget.Latest,
    true
  );
  const transformed = ts.transform(source, [
    (context) => {
      const unknown = (node) => {
        onUnresolved?.(node.getText(source));
        return context.factory.createKeywordTypeNode(
          ts.SyntaxKind.UnknownKeyword
        );
      };
      const unionMembers = (node) => {
        if (ts.isParenthesizedTypeNode(node))
          return unionMembers(node.type);
        if (ts.isUnionTypeNode(node))
          return node.types.flatMap(unionMembers);
        return [node];
      };
      const unsupportedKey = (node) => node.kind === ts.SyntaxKind.NumberKeyword || ts.isTemplateLiteralTypeNode(node) || (ts.forEachChild(
        node,
        (child) => unsupportedKey(child) || void 0
      ) ?? false);
      const visit = (node) => {
        if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
          const name = node.typeName.text;
          if (name === "ReadonlyArray" && node.typeArguments?.length === 1)
            return context.factory.createArrayTypeNode(
              ts.visitNode(
                node.typeArguments[0],
                visit
              )
            );
          if (name === "Readonly" && node.typeArguments?.length === 1)
            return ts.visitNode(node.typeArguments[0], visit);
          if (name === "Record" && node.typeArguments?.[0] && unsupportedKey(node.typeArguments[0]))
            return unknown(node);
        }
        if (ts.isFunctionTypeNode(node) || ts.isTemplateLiteralTypeNode(node) || ts.isTupleTypeNode(node) && node.elements.some(
          (element) => ts.isNamedTupleMember(element) || ts.isRestTypeNode(element) || ts.isOptionalTypeNode(element)
        ))
          return unknown(node);
        if (ts.isIntersectionTypeNode(node)) {
          const types = node.types.map((type2) => ts.visitNode(type2, visit)).filter(
            (type2) => type2.kind !== ts.SyntaxKind.UnknownKeyword
          );
          if (types.length === 1) return types[0];
          if (types.length)
            return context.factory.createIntersectionTypeNode(types);
          return context.factory.createKeywordTypeNode(
            ts.SyntaxKind.UnknownKeyword
          );
        }
        if (ts.isTypeLiteralNode(node)) {
          const members = [];
          const records = [];
          for (const member of node.members) {
            if (ts.isIndexSignatureDeclaration(member)) {
              const key = member.parameters[0]?.type;
              if (key?.kind === ts.SyntaxKind.SymbolKeyword)
                continue;
              if (key && key.kind !== ts.SyntaxKind.StringKeyword) {
                onUnresolved?.(member.getText(source));
                continue;
              }
              records.push(
                context.factory.createTypeReferenceNode(
                  "Record",
                  [
                    key ? ts.visitNode(
                      key,
                      visit
                    ) : context.factory.createKeywordTypeNode(
                      ts.SyntaxKind.StringKeyword
                    ),
                    ts.visitNode(
                      member.type,
                      visit
                    )
                  ]
                )
              );
            } else if (ts.isPropertySignature(member) && propertyName(member.name) !== void 0) {
              members.push(
                ts.visitNode(member, visit)
              );
            }
          }
          if (node.members.length && !members.length && !records.length)
            return context.factory.createKeywordTypeNode(
              ts.SyntaxKind.UnknownKeyword
            );
          if (!records.length)
            return context.factory.createTypeLiteralNode(members);
          if (members.length)
            records.unshift(
              context.factory.createTypeLiteralNode(members)
            );
          return records.length === 1 ? records[0] : context.factory.createIntersectionTypeNode(records);
        }
        if (ts.isTypeQueryNode(node) || ts.isMappedTypeNode(node) || ts.isConditionalTypeNode(node) || ts.isIndexedAccessTypeNode(node) || ts.isTypeReferenceNode(node) && (node.typeArguments?.length && !genericTypes.has(node.typeName.getText(source)) || ts.isQualifiedName(node.typeName))) {
          onUnresolved?.(node.getText(source));
          return context.factory.createKeywordTypeNode(
            ts.SyntaxKind.UnknownKeyword
          );
        }
        if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword)
          return ts.visitNode(node.type, visit);
        if (ts.isPropertySignature(node)) {
          const name = propertyName(node.name);
          let type2 = node.type;
          const members = type2 ? unionMembers(type2) : [];
          const types = members.filter(
            (type3) => type3.kind !== ts.SyntaxKind.UndefinedKeyword
          );
          const optional = members.length > 1 && types.length !== members.length;
          if (optional && type2) {
            if (types.length === 1) type2 = types[0];
            else if (types.length)
              type2 = context.factory.createUnionTypeNode(types);
            else type2 = unknown(type2);
          }
          return context.factory.updatePropertySignature(
            node,
            node.modifiers?.filter(
              (modifier) => modifier.kind !== ts.SyntaxKind.ReadonlyKeyword
            ),
            name === void 0 ? node.name : context.factory.createStringLiteral(name),
            node.questionToken ?? (optional ? context.factory.createToken(
              ts.SyntaxKind.QuestionToken
            ) : void 0),
            type2 ? ts.visitNode(type2, visit) : void 0
          );
        }
        return ts.visitEachChild(node, visit, context);
      };
      return (root) => ts.visitNode(root, visit);
    }
  ]);
  try {
    const result = transformed.transformed[0].statements[0];
    return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, result.type, source);
  } finally {
    transformed.dispose();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  extractRouteDeclarations,
  flattenNestedIntersections,
  normalizeGeneratedSchema,
  prepareTypeForParser
});
