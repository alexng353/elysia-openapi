// src/openapi.ts
import { t } from "elysia";
import {
  Kind
} from "@sinclair/typebox";
var capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);
var toRef = (name) => t.Ref(
  name.startsWith("#/") ? name : `#/components/schemas/${name}`
);
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
var mergeSchemaProperty = (existing, incoming, vendors) => {
  if (!existing) return incoming;
  if (!incoming) return existing;
  let existingSchema = normalizeSchemaReference(existing);
  let incomingSchema = normalizeSchemaReference(incoming);
  if (!existingSchema) return incoming;
  if (!incomingSchema) return existing;
  if (!isTSchema(incomingSchema) && incomingSchema["~standard"])
    incomingSchema = unwrapSchema(incomingSchema, vendors);
  if (!isTSchema(existingSchema) && existingSchema["~standard"])
    existingSchema = unwrapSchema(existingSchema, vendors);
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
var unwrapResponseSchema = (schema, vendors) => typeof schema === "string" ? normalizeSchemaReference(schema) : !schema ? void 0 : isTSchema(schema) ? schema : (
  // @ts-ignore
  schema["~standard"] ? unwrapSchema(schema, vendors, "output") : Object.fromEntries(
    Object.entries(schema).map(([status, schema2]) => [
      status,
      typeof schema2 === "string" ? normalizeSchemaReference(schema2) : isTSchema(schema2) ? schema2 : unwrapSchema(
        schema2,
        vendors,
        "output"
      )
    ])
  )
);
var mergeResponseSchema = (_existing, _incoming, vendors) => {
  if (!_existing) return _incoming;
  if (!_incoming) return _existing;
  let existing = unwrapResponseSchema(_existing, vendors);
  let incoming = unwrapResponseSchema(_incoming, vendors);
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
        vendors
      );
    else if (existingSchema) schema[status] = existingSchema;
    else if (incomingSchema) schema[status] = incomingSchema;
  }
  return schema;
};
var mergeStandaloneValidators = (hooks, vendors) => {
  const merged = { ...hooks };
  if (!hooks.standaloneValidator?.length) return merged;
  for (const validator of hooks.standaloneValidator) {
    if (validator.body)
      merged.body = mergeSchemaProperty(
        merged.body,
        validator.body,
        vendors
      );
    if (validator.headers)
      merged.headers = mergeSchemaProperty(
        merged.headers,
        validator.headers,
        vendors
      );
    if (validator.query)
      merged.query = mergeSchemaProperty(
        merged.query,
        validator.query,
        vendors
      );
    if (validator.params)
      merged.params = mergeSchemaProperty(
        merged.params,
        validator.params,
        vendors
      );
    if (validator.cookie)
      merged.cookie = mergeSchemaProperty(
        merged.cookie,
        validator.cookie,
        vendors
      );
    if (validator.response)
      merged.response = mergeResponseSchema(
        merged.response,
        validator.response,
        vendors
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
var flattenRoutes = (routes, vendors) => routes.map((route) => {
  if (!route.hooks?.standaloneValidator?.length) return route;
  return {
    ...route,
    hooks: mergeStandaloneValidators(route.hooks, vendors)
  };
});
var unwrapReference = (schema, definitions) => {
  const ref = schema?.$ref;
  if (!ref) return schema;
  const name = ref.slice(ref.lastIndexOf("/") + 1);
  if (ref && definitions[name]) schema = definitions[name];
  return enumToOpenApi(schema);
};
var unwrapSchema = (schema, mapJsonSchema, io = "input") => {
  if (!schema) return;
  if (typeof schema === "string") schema = toRef(schema);
  if (Kind in schema) return enumToOpenApi(schema);
  if (!schema?.["~standard"] && // @ts-ignore
  (schema.$schema || schema.type || schema.properties || schema.items))
    return schema;
  if (!schema?.["~standard"]) return;
  const vendor = schema["~standard"].vendor;
  try {
    if (mapJsonSchema?.[vendor] && typeof mapJsonSchema[vendor] === "function")
      return enumToOpenApi(mapJsonSchema[vendor](schema));
    if (schema["~standard"]?.jsonSchema?.[io])
      return enumToOpenApi(schema["~standard"].jsonSchema[io]({
        target: "draft-2020-12"
      }));
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
      return enumToOpenApi(schema?.toJsonSchema?.());
    return enumToOpenApi(
      // @ts-ignore
      schema.toJSONSchema?.() ?? schema?.toJsonSchema?.()
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
  return schema;
};
function toOpenAPISchema(app, exclude, references, vendors, onlyExternal) {
  let {
    methods: excludeMethods = ["options"],
    staticFile: excludeStaticFile = true,
    tags: excludeTags
  } = exclude ?? {};
  excludeMethods = excludeMethods.map((method) => method.toLowerCase());
  const excludePaths = Array.isArray(exclude?.paths) ? exclude.paths : typeof exclude?.paths !== "undefined" ? [exclude.paths] : [];
  const paths = /* @__PURE__ */ Object.create(null);
  const definitions = app.getGlobalDefinitions?.().type;
  const routes = flattenRoutes(app.getGlobalRoutes(), vendors);
  if (references) {
    let hasRoutes = !onlyExternal;
    if (!hasRoutes) {
      for (const route of routes) {
        if (route.hooks?.detail?.hide) continue;
        if (route.hooks?.detail?.external) {
          hasRoutes = true;
          break;
        }
      }
    }
    if (hasRoutes) {
      if (!Array.isArray(references)) references = [references];
      for (let i = 0; i < references.length; i++) {
        const reference = references[i];
        if (typeof reference === "function") references[i] = reference();
      }
    } else {
      references = void 0;
    }
  }
  for (const route of routes) {
    if (route.hooks?.detail?.hide) continue;
    if (onlyExternal && !route.hooks?.detail?.external) continue;
    const method = route.method.toLowerCase();
    if (excludeStaticFile && route.path.includes(".") || excludePaths.includes(route.path) || excludeMethods.includes(method))
      continue;
    const hooks = route.hooks ?? {};
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
              else if (typeof hooks.response !== "object" || hooks.response.type || hooks.response.$ref || hooks.response["~standard"])
                hooks.response = {
                  200: hooks.response
                };
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
    if (excludeTags && hooks.detail.tags?.some((tag) => excludeTags?.includes(tag)))
      continue;
    const operation = {
      ...hooks.detail
    };
    const parameters = [];
    if (hooks.params) {
      const params = unwrapReference(
        unwrapSchema(hooks.params, vendors),
        definitions
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
        unwrapSchema(hooks.query, vendors),
        definitions
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
        unwrapSchema(hooks.headers, vendors),
        definitions
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
        unwrapSchema(hooks.cookie, vendors),
        definitions
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
      const body = unwrapSchema(hooks.body, vendors);
      if (body) {
        const { type, description, $ref, ...options } = unwrapReference(
          body,
          definitions
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
      !hooks.response.type && !hooks.response.$ref && !hooks.response["~standard"]) {
        for (let [status, schema] of Object.entries(hooks.response)) {
          const response = unwrapSchema(schema, vendors, "output");
          if (!response) continue;
          const { type, description, $ref, ..._options } = unwrapReference(response, definitions);
          operation.responses[status] = {
            description: description ?? `Response for status ${status}`,
            content: type === "void" || type === "null" || type === "undefined" ? { type, description } : type === "string" || type === "number" || type === "integer" || type === "boolean" ? {
              "text/plain": {
                schema: response
              }
            } : {
              "application/json": {
                schema: response
              }
            }
          };
        }
      } else {
        const response = unwrapSchema(
          hooks.response,
          vendors,
          "output"
        );
        if (response) {
          const {
            type: _type,
            description,
            ...options
          } = unwrapReference(response, definitions);
          const type = _type;
          operation.responses["200"] = {
            description: description ?? `Response for status 200`,
            content: type === "void" || type === "null" || type === "undefined" ? { type, description } : type === "string" || type === "number" || type === "integer" || type === "boolean" ? {
              "text/plain": {
                schema: response
              }
            } : {
              "application/json": {
                schema: response
              }
            }
          };
        }
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
      const jsonSchema = unwrapSchema(schema, vendors);
      if (jsonSchema) schemas[name] = jsonSchema;
    }
  return {
    components: {
      schemas
    },
    paths
  };
}
var withHeaders = (schema, headers) => Object.assign(schema, {
  headers
});
export {
  capitalize,
  enumToOpenApi,
  getLoosePath,
  getPossiblePath,
  toOpenAPISchema,
  unwrapSchema,
  withHeaders
};
