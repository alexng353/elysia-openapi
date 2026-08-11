// src/swagger/index.ts
function isSchemaObject(schema) {
  return "type" in schema || "properties" in schema || "items" in schema;
}
function isDateTimeProperty(key, schema) {
  return (key === "createdAt" || key === "updatedAt") && "anyOf" in schema && Array.isArray(schema.anyOf);
}
function transformDateProperties(schema) {
  if (!isSchemaObject(schema) || typeof schema !== "object" || schema === null)
    return schema;
  const newSchema = { ...schema };
  Object.entries(newSchema).forEach(([key, value]) => {
    if (isSchemaObject(value)) {
      if (isDateTimeProperty(key, value)) {
        const dateTimeFormat = value.anyOf?.find(
          (item) => isSchemaObject(item) && item.format === "date-time"
        );
        if (dateTimeFormat) {
          const dateTimeSchema = {
            type: "string",
            format: "date-time",
            default: dateTimeFormat.default
          };
          newSchema[key] = dateTimeSchema;
        }
      } else {
        ;
        newSchema[key] = transformDateProperties(value);
      }
    }
  });
  return newSchema;
}
var SwaggerUIRender = (info, config) => {
  const {
    version = "latest",
    theme = `https://unpkg.com/swagger-ui-dist@${version ?? "latest"}/swagger-ui.css`,
    cdn = `https://unpkg.com/swagger-ui-dist@${version}/swagger-ui-bundle.js`,
    autoDarkMode = true,
    ...rest
  } = config;
  const stringifiedOptions = JSON.stringify(
    {
      dom_id: "#swagger-ui",
      ...rest
    },
    (_, value) => typeof value === "function" ? void 0 : value
  );
  const options = JSON.parse(stringifiedOptions);
  if (options.components && options.components.schemas)
    options.components.schemas = Object.fromEntries(
      Object.entries(options.components.schemas).map(([key, schema]) => [
        key,
        transformDateProperties(schema)
      ])
    );
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${info.title}</title>
    <meta
        name="description"
        content="${info.description}"
    />
    <meta
        name="og:description"
        content="${info.description}"
    />
    ${autoDarkMode && typeof theme === "string" ? `<style>
@media (prefers-color-scheme: dark) {
    body {
        background-color: #222;
        color: #faf9a;
    }
    .swagger-ui {
        filter: invert(92%) hue-rotate(180deg);
    }

    .swagger-ui .microlight {
        filter: invert(100%) hue-rotate(180deg);
    }
}
</style>` : ""}
    ${typeof theme === "string" ? `<link rel="stylesheet" href="${theme}" />` : `<link rel="stylesheet" media="(prefers-color-scheme: light)" href="${theme.light}" />
<link rel="stylesheet" media="(prefers-color-scheme: dark)" href="${theme.dark}" />`}
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="${cdn}" crossorigin></script>
    <script>
        window.onload = () => {
            window.ui = SwaggerUIBundle(${stringifiedOptions});
        };
    </script>
</body>
</html>`;
};
export {
  SwaggerUIRender,
  transformDateProperties
};
