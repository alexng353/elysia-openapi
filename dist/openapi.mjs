// src/openapi.ts
import { t } from "elysia";
import { Kind } from "@sinclair/typebox";
var capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
var toRef = (name) => t.Ref(name.startsWith("#/") ? name : `#/components/schemas/${name}`);
var toOperationId = (method, paths) => {
  let operationId = method.toLowerCase();
  if (!paths || paths === "/") return operationId + "Index";
  for (const path of paths.split("/"))
    operationId += path.includes(":") ? "By" + capitalize(path.replace(":", "")) : capitalize(path);
  operationId = operationId.replace(/\?/g, "Optional");
  return operationId;
};
var optionalParamsRegex = /(\/:\w+\?)/g;
var getPossiblePath = (path) => {
  const optionalParams = path.match(optionalParamsRegex);
  if (!optionalParams) return [path];
  const originalPath = path.replace(/\?/g, "");
  const paths = [originalPath];
  for (let i = 0; i < optionalParams.length; i++) {
    const newPath = path.replace(optionalParams[i], "");
    paths.push(...getPossiblePath(newPath));
  }
  return paths;
};
var isValidSchema = (schema) => schema && typeof schema === "object" && (Kind in schema && schema[Kind] !== "Unknown" || schema.type || schema.properties || schema.items);
var getLoosePath = (path) => {
  if (path.charCodeAt(path.length - 1) === 47)
    return path.slice(0, path.length - 1);
  return path + "/";
};
var warnings = {
  zod4: `import openapi from '@elysiajs/openapi'
import * as z from 'zod'

openapi({
  mapJsonSchema: {
    zod: z.toJSONSchema
  }
})`,
  zod3: `import openapi from '@elysiajs/openapi'
import { zodToJsonSchema } from 'zod-to-json-schema'

openapi({
  mapJsonSchema: {
    zod: zodToJsonSchema
  }
})`,
  valibot: `import openapi from '@elysiajs/openapi'
import { toJsonSchema } from '@valibot/to-json-schema'

openapi({
  mapJsonSchema: {
    valibot: toJsonSchema
  }
})`,
  effect: `import { JSONSchema } from 'effect'

openapi({
  mapJsonSchema: {
    effect: JSONSchema.make
  }
})`
};
var warned = {};
var mergeObjectSchemas = (schemas) => {
  if (schemas.length === 0)
    return {
      schema: void 0,
      notObjects: []
    };
  if (schemas.length === 1)
    return schemas[0].type === "object" ? {
      schema: schemas[0],
      notObjects: []
    } : {
      schema: void 0,
      notObjects: schemas
    };
  let newSchema;
  const notObjects = [];
  let additionalPropertiesIsTrue = false;
  let additionalPropertiesIsFalse = false;
  for (const schema of schemas) {
    if (!schema) continue;
    if (schema.type !== "object") {
      notObjects.push(schema);
      continue;
    }
    if ("additionalProperties" in schema) {
      if (schema.additionalProperties === true)
        additionalPropertiesIsTrue = true;
      else if (schema.additionalProperties === false)
        additionalPropertiesIsFalse = true;
    }
    if (!newSchema) {
      newSchema = schema;
      continue;
    }
    newSchema = {
      ...newSchema,
      ...schema,
      properties: {
        ...newSchema.properties,
        ...schema.properties
      },
      required: [
        ...newSchema?.required ?? [],
        ...schema.required ?? []
      ]
    };
  }
  if (newSchema) {
    if (newSchema.required)
      newSchema.required = [...new Set(newSchema.required)];
    if (additionalPropertiesIsFalse) newSchema.additionalProperties = false;
    else if (additionalPropertiesIsTrue)
      newSchema.additionalProperties = true;
  }
  return {
    schema: newSchema,
    notObjects
  };
};
var isTSchema = (value) => {
  if (!value || typeof value !== "object") return false;
  if (Kind in value) return true;
  const keys = Object.keys(value);
  if (keys.length > 0 && keys.every((k) => !isNaN(Number(k)))) {
    return false;
  }
  return false;
};
var normalizeSchemaReference = (schema) => {
  if (!schema) return void 0;
  if (typeof schema !== "string") return schema;
  return toRef(schema);
};
var mergeSchemaProperty = (existing, incoming, vendors, openapiVersion = "3.1.2") => {
  if (!existing) return incoming;
  if (!incoming) return existing;
  let existingSchema = normalizeSchemaReference(existing);
  let incomingSchema = normalizeSchemaReference(incoming);
  if (!existingSchema) return incoming;
  if (!incomingSchema) return existing;
  if (!isTSchema(incomingSchema) && incomingSchema["~standard"])
    incomingSchema = unwrapSchema(
      incomingSchema,
      vendors,
      "input",
      openapiVersion
    );
  if (!isTSchema(existingSchema) && existingSchema["~standard"])
    existingSchema = unwrapSchema(
      existingSchema,
      vendors,
      "input",
      openapiVersion
    );
  if (!incomingSchema) return existingSchema;
  if (!existingSchema) return incomingSchema;
  const { schema: mergedSchema, notObjects } = mergeObjectSchemas([
    existingSchema,
    incomingSchema
  ]);
  if (notObjects.length > 0) {
    if (mergedSchema) return t.Intersect([mergedSchema, ...notObjects]);
    return notObjects.length === 1 ? notObjects[0] : t.Intersect(notObjects);
  }
  return mergedSchema;
};
var unwrapResponseSchema = (schema, vendors, openapiVersion = "3.1.2") => typeof schema === "string" ? normalizeSchemaReference(schema) : !schema ? void 0 : isTSchema(schema) ? schema : (
  // @ts-expect-error Responses can include Standard Schema validators.
  schema["~standard"] ? unwrapSchema(
    schema,
    vendors,
    "output",
    openapiVersion
  ) : Object.fromEntries(
    Object.entries(schema).map(([status, schema2]) => [
      status,
      typeof schema2 === "string" ? normalizeSchemaReference(schema2) : isTSchema(schema2) ? schema2 : unwrapSchema(
        schema2,
        vendors,
        "output",
        openapiVersion
      )
    ])
  )
);
var mergeResponseSchema = (_existing, _incoming, vendors, openapiVersion = "3.1.2") => {
  if (!_existing) return _incoming;
  if (!_incoming) return _existing;
  let existing = unwrapResponseSchema(_existing, vendors, openapiVersion);
  let incoming = unwrapResponseSchema(_incoming, vendors, openapiVersion);
  if (!existing && !incoming) return void 0;
  if (incoming && !existing) return incoming;
  if (existing && !incoming) return existing;
  if (isTSchema(existing) || existing?.["~standard"])
    existing = {
      200: existing
    };
  if (isTSchema(incoming) || incoming?.["~standard"])
    incoming = {
      200: incoming
    };
  const schema = {
    ...incoming
  };
  for (const status of Object.keys(existing ?? {})) {
    const existingSchema = existing[status];
    const incomingSchema = incoming[status];
    if (existingSchema && incomingSchema)
      schema[status] = mergeSchemaProperty(
        existingSchema,
        incomingSchema,
        vendors,
        openapiVersion
      );
    else if (existingSchema) schema[status] = existingSchema;
    else if (incomingSchema) schema[status] = incomingSchema;
  }
  return schema;
};
var mergeStandaloneValidators = (hooks, vendors, openapiVersion = "3.1.2") => {
  const merged = { ...hooks };
  if (!hooks.standaloneValidator?.length) return merged;
  for (const validator of hooks.standaloneValidator) {
    if (validator.body)
      merged.body = mergeSchemaProperty(
        merged.body,
        validator.body,
        vendors,
        openapiVersion
      );
    if (validator.headers)
      merged.headers = mergeSchemaProperty(
        merged.headers,
        validator.headers,
        vendors,
        openapiVersion
      );
    if (validator.query)
      merged.query = mergeSchemaProperty(
        merged.query,
        validator.query,
        vendors,
        openapiVersion
      );
    if (validator.params)
      merged.params = mergeSchemaProperty(
        merged.params,
        validator.params,
        vendors,
        openapiVersion
      );
    if (validator.cookie)
      merged.cookie = mergeSchemaProperty(
        merged.cookie,
        validator.cookie,
        vendors,
        openapiVersion
      );
    if (validator.response)
      merged.response = mergeResponseSchema(
        merged.response,
        validator.response,
        vendors,
        openapiVersion
      );
  }
  if (typeof merged.body === "string")
    merged.body = normalizeSchemaReference(merged.body);
  if (typeof merged.headers === "string")
    merged.headers = normalizeSchemaReference(merged.headers);
  if (typeof merged.query === "string")
    merged.query = normalizeSchemaReference(merged.query);
  if (typeof merged.params === "string")
    merged.params = normalizeSchemaReference(merged.params);
  if (typeof merged.cookie === "string")
    merged.cookie = normalizeSchemaReference(merged.cookie);
  if (merged.response && typeof merged.response !== "string") {
    const response = merged.response;
    if ("type" in response || "$ref" in response) {
      if (typeof response === "string")
        merged.response = normalizeSchemaReference(response);
    } else {
      for (const [status, schema] of Object.entries(response))
        if (typeof schema === "string")
          response[status] = normalizeSchemaReference(schema);
    }
  }
  return merged;
};
var flattenRoutes = (routes, vendors, openapiVersion = "3.1.2") => routes.map((route) => {
  if (!route.hooks?.standaloneValidator?.length) return route;
  return {
    ...route,
    hooks: mergeStandaloneValidators(
      route.hooks,
      vendors,
      openapiVersion
    )
  };
});
var unwrapReference = (schema, definitions, openapiVersion = "3.1.2") => {
  const ref = schema?.$ref;
  if (!ref) return schema;
  const name = ref.slice(ref.lastIndexOf("/") + 1);
  if (ref && definitions[name]) schema = definitions[name];
  return nullToOpenApi(enumToOpenApi(schema), openapiVersion);
};
var unwrapSchema = (schema, mapJsonSchema, io = "input", openapiVersion = "3.1.2") => {
  if (!schema) return;
  if (typeof schema === "string") schema = toRef(schema);
  if (Kind in schema)
    return nullToOpenApi(enumToOpenApi(schema), openapiVersion);
  if (!schema?.["~standard"] && // @ts-expect-error Merged validators may already be plain JSON Schema objects.
  (schema.$schema || schema.type || schema.properties || schema.items))
    return nullToOpenApi(schema, openapiVersion);
  if (!schema?.["~standard"]) return;
  const standard = schema["~standard"];
  const vendor = standard.vendor;
  try {
    const jsonSchemaTarget = openapiVersion.startsWith("3.0.") ? "draft-07" : "draft-2020-12";
    if (mapJsonSchema?.[vendor] && typeof mapJsonSchema[vendor] === "function")
      return nullToOpenApi(
        enumToOpenApi(mapJsonSchema[vendor](schema)),
        openapiVersion
      );
    if (standard.jsonSchema?.[io])
      return nullToOpenApi(
        enumToOpenApi(
          standard.jsonSchema[io]({
            target: jsonSchemaTarget
          })
        ),
        openapiVersion
      );
    switch (vendor) {
      case "zod":
        if (warned.zod4 || warned.zod3) break;
        console.warn(
          "[@elysiajs/openapi] Zod doesn't provide JSON Schema method on the schema"
        );
        if ("_zod" in schema) {
          warned.zod4 = true;
          console.warn(
            "For Zod v4, please provide z.toJSONSchema as follows:\n"
          );
          console.warn(warnings.zod4);
        } else {
          warned.zod3 = true;
          console.warn(
            "For Zod v3, please install zod-to-json-schema package and use it like this:\n"
          );
          console.warn(warnings.zod3);
        }
        break;
      case "valibot":
        if (warned.valibot) break;
        warned.valibot = true;
        console.warn(
          "[@elysiajs/openapi] Valibot require a separate package for JSON Schema conversion"
        );
        console.warn(
          "Please install @valibot/to-json-schema package and use it like this:\n"
        );
        console.warn(warnings.valibot);
        break;
      case "effect":
        if (warned.effect) break;
        warned.effect = true;
        console.warn(
          "[@elysiajs/openapi] Effect Schema doesn't provide JSON Schema method on the schema"
        );
        console.warn(
          "please provide JSONSchema from 'effect' package as follows:\n"
        );
        console.warn(warnings.effect);
        break;
    }
    if (vendor === "arktype")
      return nullToOpenApi(
        enumToOpenApi(schema.toJsonSchema?.()),
        openapiVersion
      );
    return nullToOpenApi(
      enumToOpenApi(
        // @ts-expect-error Vendor methods are outside the Standard Schema interface.
        schema.toJSONSchema?.() ?? schema?.toJsonSchema?.()
      ),
      openapiVersion
    );
  } catch (error) {
    console.warn(error);
  }
};
var enumToOpenApi = (_schema) => {
  if (!_schema || typeof _schema !== "object") return _schema;
  if (Kind in _schema) {
    const schema2 = _schema;
    if (schema2[Kind] === "Union" && schema2.anyOf && Array.isArray(schema2.anyOf) && schema2.anyOf.length > 0 && schema2.anyOf.every(
      (item) => item && typeof item === "object" && item.const !== void 0
    ))
      return {
        type: "string",
        enum: schema2.anyOf.map((item) => item.const)
      };
  }
  const schema = _schema;
  if (schema.type === "object" && schema.properties) {
    const properties = {};
    for (const [key, value] of Object.entries(schema.properties))
      properties[key] = enumToOpenApi(value);
    return {
      ...schema,
      properties
    };
  }
  if (schema.type === "array" && schema.items)
    return {
      ...schema,
      items: enumToOpenApi(schema.items)
    };
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const mapped = schema.anyOf.map(
      (item) => item && typeof item === "object" && item.type === "Date" ? { type: "string", format: "date-time" } : enumToOpenApi(item)
    );
    const seen = /* @__PURE__ */ new Set();
    const deduped = mapped.filter((item) => {
      if (!item || typeof item !== "object") return true;
      const key = JSON.stringify(
        Object.fromEntries(
          Object.entries(item).sort(
            ([a], [b]) => a < b ? -1 : a > b ? 1 : 0
          )
        )
      );
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (deduped.length === 1) return deduped[0];
    return { ...schema, anyOf: deduped };
  }
  return schema;
};
var SCHEMA_MAP_KEYS = /* @__PURE__ */ new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas"
]);
var SCHEMA_ARRAY_KEYS = /* @__PURE__ */ new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
var SCHEMA_VALUE_KEYS = /* @__PURE__ */ new Set([
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "propertyNames"
]);
var isSchemaObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var nullToOpenApi = (schema, openapiVersion) => {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!isSchemaObject(value)) return value;
    const normalized = { ...value };
    const isOpenAPI30 = openapiVersion.startsWith("3.0.");
    for (const unionKey of ["anyOf", "oneOf"]) {
      const union = normalized[unionKey];
      if (!Array.isArray(union)) continue;
      const nonNull = union.filter(
        (item) => !isSchemaObject(item) || item.type !== "null"
      );
      if (nonNull.length === union.length) continue;
      const normalizedNonNull = nonNull.map(normalize);
      if (isOpenAPI30) {
        delete normalized[unionKey];
        if (normalizedNonNull.length === 1 && isSchemaObject(normalizedNonNull[0]))
          Object.assign(normalized, normalizedNonNull[0]);
        else if (normalizedNonNull.length)
          normalized[unionKey] = normalizedNonNull;
        normalized.nullable = true;
      } else if (normalizedNonNull.length === 1 && isSchemaObject(normalizedNonNull[0]) && typeof normalizedNonNull[0].type === "string") {
        delete normalized[unionKey];
        Object.assign(normalized, normalizedNonNull[0]);
        normalized.type = [normalizedNonNull[0].type, "null"];
      } else normalized[unionKey] = union.map(normalize);
    }
    if (isOpenAPI30 && normalized.type === "null") {
      delete normalized.type;
      normalized.nullable = true;
    } else if (isOpenAPI30 && Array.isArray(normalized.type) && normalized.type.includes("null")) {
      const types = normalized.type.filter((type) => type !== "null");
      normalized.nullable = true;
      if (types.length === 1) normalized.type = types[0];
      else if (types.length) normalized.type = types;
      else delete normalized.type;
    }
    for (const [key, nested] of Object.entries(normalized)) {
      if (SCHEMA_MAP_KEYS.has(key) && isSchemaObject(nested))
        normalized[key] = Object.fromEntries(
          Object.entries(nested).map(([name, child]) => [
            name,
            normalize(child)
          ])
        );
      else if (SCHEMA_ARRAY_KEYS.has(key) && Array.isArray(nested))
        normalized[key] = nested.map(normalize);
      else if (SCHEMA_VALUE_KEYS.has(key) && isSchemaObject(nested))
        normalized[key] = normalize(nested);
      else if (key === "dependencies" && isSchemaObject(nested))
        normalized[key] = Object.fromEntries(
          Object.entries(nested).map(([name, child]) => [
            name,
            isSchemaObject(child) ? normalize(child) : child
          ])
        );
    }
    return normalized;
  };
  return normalize(schema);
};
var toResponseHeaders = (schema, vendors, openapiVersion = "3.1.2") => {
  if (!schema || typeof schema === "string" || !("headers" in schema) || !schema.headers)
    return;
  const entries = Object.entries(
    schema.headers
  ).map(
    ([name, hs]) => [
      name,
      {
        schema: unwrapSchema(
          hs,
          vendors,
          "output",
          openapiVersion
        )
      }
    ]
  ).filter(([, v]) => v.schema);
  return entries.length ? Object.fromEntries(entries) : void 0;
};
var stripHeaders = (schema) => {
  const { headers, ...rest } = schema;
  return rest;
};
var VOID_TYPES = /* @__PURE__ */ new Set(["void", "null", "undefined"]);
var PLAIN_TYPES = /* @__PURE__ */ new Set(["string", "number", "integer", "boolean"]);
var toResponseContent = (schema, type) => VOID_TYPES.has(type) ? void 0 : PLAIN_TYPES.has(type) ? { "text/plain": { schema } } : { "application/json": { schema } };
var toResponseObject = (schema, status, definitions, vendors, openapiVersion = "3.1.2") => {
  const response = unwrapSchema(schema, vendors, "output", openapiVersion);
  if (!response) return;
  const responseSchema = stripHeaders(response);
  const { type, description } = unwrapReference(
    responseSchema,
    definitions,
    openapiVersion
  );
  const headers = toResponseHeaders(schema, vendors, openapiVersion);
  const content = toResponseContent(responseSchema, type);
  return {
    description: description ?? `Response for status ${status}`,
    ...headers ? { headers } : {},
    ...content ? { content } : {}
  };
};
function toOpenAPISchema(app, exclude, references, vendors, openapiVersion = "3.1.2") {
  const {
    methods = ["options"],
    staticFile: excludeStaticFile = true,
    tags: excludeTags
  } = exclude ?? {};
  const excludeMethods = methods.map((method) => method.toLowerCase());
  const excludePaths = Array.isArray(exclude?.paths) ? exclude.paths : typeof exclude?.paths !== "undefined" ? [exclude.paths] : [];
  const paths = /* @__PURE__ */ Object.create(null);
  const definitions = app.getGlobalDefinitions?.().type;
  const routes = app.getGlobalRoutes().filter((route) => {
    if (route.hooks?.detail?.hide) return false;
    const method = route.method.toLowerCase();
    if (excludeStaticFile && route.path.includes(".") || excludePaths.some((exclusion) => {
      if (exclusion instanceof RegExp) {
        exclusion.lastIndex = 0;
        return exclusion.test(route.path);
      }
      if (typeof exclusion === "string")
        return exclusion === route.path;
      return false;
    }) || excludeMethods.includes(method) || route.hooks?.detail?.tags?.some(
      (tag) => excludeTags?.includes(tag)
    ))
      return false;
    return !exclude?.routes?.(route);
  });
  if (routes.length && references)
    references = (Array.isArray(references) ? references : [references]).map(
      (reference) => typeof reference === "function" ? reference() : reference
    );
  for (const route of flattenRoutes(routes, vendors, openapiVersion)) {
    const method = route.method.toLowerCase();
    const hooks = { ...route.hooks };
    if (references?.length)
      for (const reference of references) {
        if (!reference) continue;
        const refer = reference[route.path]?.[method] ?? reference[getLoosePath(route.path)]?.[method];
        if (!refer) continue;
        if (!hooks.body && isValidSchema(refer.body))
          hooks.body = refer.body;
        if (!hooks.query && isValidSchema(refer.query))
          hooks.query = refer.query;
        if (!hooks.params && isValidSchema(refer.params))
          hooks.params = refer.params;
        if (!hooks.headers && isValidSchema(refer.headers))
          hooks.headers = refer.headers;
        if (refer.response) {
          for (const [status, schema] of Object.entries(
            refer.response
          ))
            if (isValidSchema(schema)) {
              if (!hooks.response) hooks.response = {};
              else if (typeof hooks.response !== "object" || Kind in hooks.response || hooks.response.type || hooks.response.$ref || hooks.response["~standard"])
                hooks.response = {
                  200: hooks.response
                };
              else hooks.response = { ...hooks.response };
              if (!hooks.response[status])
                try {
                  hooks.response[status] = schema;
                } catch (error) {
                  console.log(
                    "[@elysiajs/openapi/gen] Failed to assigned response schema"
                  );
                  console.log(error);
                }
            }
        }
      }
    const operation = {
      ...hooks.detail
    };
    const parameters = [];
    if (hooks.params) {
      const params = unwrapReference(
        unwrapSchema(hooks.params, vendors, "input", openapiVersion),
        definitions,
        openapiVersion
      );
      if (params && params.type === "object" && params.properties)
        for (const [name, schema] of Object.entries(params.properties))
          parameters.push({
            name,
            in: "path",
            required: true,
            // Path parameters are always required
            schema
          });
    } else {
      for (const match of route.path.matchAll(/:([^/]+)/g)) {
        const name = match[1].replace("?", "");
        parameters.push({
          name,
          in: "path",
          required: true,
          schema: { type: "string" }
        });
      }
    }
    if (hooks.query) {
      const query = unwrapReference(
        unwrapSchema(hooks.query, vendors, "input", openapiVersion),
        definitions,
        openapiVersion
      );
      if (query && query.type === "object" && query.properties) {
        const required = query.required || [];
        for (const [name, schema] of Object.entries(query.properties))
          parameters.push({
            name,
            in: "query",
            required: required.includes(name),
            schema
          });
      }
    }
    if (hooks.headers) {
      const headers = unwrapReference(
        unwrapSchema(hooks.headers, vendors, "input", openapiVersion),
        definitions,
        openapiVersion
      );
      if (headers && headers.type === "object" && headers.properties) {
        const required = headers.required || [];
        for (const [name, schema] of Object.entries(headers.properties))
          parameters.push({
            name,
            in: "header",
            required: required.includes(name),
            schema
          });
      }
    }
    if (hooks.cookie) {
      const cookie = unwrapReference(
        unwrapSchema(hooks.cookie, vendors, "input", openapiVersion),
        definitions,
        openapiVersion
      );
      if (cookie && cookie.type === "object" && cookie.properties) {
        const required = cookie.required || [];
        for (const [name, schema] of Object.entries(cookie.properties))
          parameters.push({
            name,
            in: "cookie",
            required: required.includes(name),
            schema
          });
      }
    }
    if (parameters.length > 0) operation.parameters = parameters;
    if (hooks.body && method !== "get" && method !== "head") {
      const body = unwrapSchema(
        hooks.body,
        vendors,
        "input",
        openapiVersion
      );
      if (body) {
        const { type, description } = unwrapReference(
          body,
          definitions,
          openapiVersion
        );
        if (hooks.parse) {
          const content = {};
          const parsers = hooks.parse;
          for (const parser of parsers) {
            if (typeof parser.fn === "function") continue;
            switch (parser.fn) {
              case "text":
              case "text/plain":
                content["text/plain"] = { schema: body };
                continue;
              case "urlencoded":
              case "application/x-www-form-urlencoded":
                content["application/x-www-form-urlencoded"] = {
                  schema: body
                };
                continue;
              case "json":
              case "application/json":
                content["application/json"] = { schema: body };
                continue;
              case "formdata":
              case "multipart/form-data":
                content["multipart/form-data"] = {
                  schema: body
                };
                continue;
              case "arrayBuffer":
              case "application/octet-stream":
                content["application/octet-stream"] = {
                  schema: body
                };
                continue;
            }
          }
          operation.requestBody = {
            description,
            content,
            required: true
          };
        } else {
          operation.requestBody = {
            description,
            required: true,
            content: type === "string" || type === "number" || type === "integer" || type === "boolean" ? {
              "text/plain": {
                schema: body
              }
            } : {
              "application/json": {
                schema: body
              },
              "application/x-www-form-urlencoded": {
                schema: body
              },
              "multipart/form-data": {
                schema: body
              }
            }
          };
        }
      }
    }
    if (hooks.response) {
      operation.responses = {};
      if (typeof hooks.response === "object" && // TypeBox
      !(Kind in hooks.response) && !hooks.response.type && !hooks.response.$ref && !hooks.response["~standard"]) {
        for (const [status, schema] of Object.entries(hooks.response)) {
          const response = toResponseObject(
            schema,
            status,
            definitions,
            vendors,
            openapiVersion
          );
          if (response) operation.responses[status] = response;
        }
      } else {
        const response = toResponseObject(
          hooks.response,
          "200",
          definitions,
          vendors,
          openapiVersion
        );
        if (response) operation.responses["200"] = response;
      }
    }
    for (let path of getPossiblePath(route.path)) {
      const operationId = hooks.detail?.operationId ?? toOperationId(route.method, path);
      path = path.replace(/:([^/]+)/g, "{$1}");
      if (!paths[path]) paths[path] = {};
      const current = paths[path];
      if (method !== "all") {
        current[method] = {
          ...operation,
          operationId
        };
        continue;
      }
      for (const method2 of [
        "get",
        "post",
        "put",
        "delete",
        "patch",
        "head",
        "options",
        "trace"
      ])
        current[method2] = {
          ...operation,
          operationId
        };
    }
  }
  const schemas = /* @__PURE__ */ Object.create(null);
  if (definitions)
    for (const [name, schema] of Object.entries(definitions)) {
      const jsonSchema = unwrapSchema(
        schema,
        vendors,
        "input",
        openapiVersion
      );
      if (jsonSchema) schemas[name] = jsonSchema;
    }
  return {
    components: {
      schemas
    },
    paths
  };
}
var withHeaders = (schema, headers) => {
  const clone = Object.create(
    Object.getPrototypeOf(schema),
    Object.getOwnPropertyDescriptors(schema)
  );
  Object.defineProperty(clone, "headers", {
    value: headers,
    enumerable: true,
    configurable: true,
    writable: true
  });
  return clone;
};
export {
  capitalize,
  enumToOpenApi,
  getLoosePath,
  getPossiblePath,
  nullToOpenApi,
  toOpenAPISchema,
  unwrapSchema,
  withHeaders
};
