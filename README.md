# @elysia/openapi

[Elysia](https://github.com/elysiajs/elysia) plugin to add OpenAPI documentation.

## Installation

```bash
bun add @elysia/openapi
```

## Example

```typescript
import { Elysia, t } from 'elysia'
import { openapi } from '@elysia/openapi'

const app = new Elysia()
	.use(openapi())
	.get('/', () => 'hi', {
		response: t.String({ description: 'sample description' })
	})
	.post(
		'/json/:id',
		({ body, params: { id }, query: { name } }) => ({
			...body,
			id,
			name
		}),
		{
			params: t.Object({
				id: t.String()
			}),
			query: t.Object({
				name: t.String()
			}),
			body: t.Object({
				username: t.String(),
				password: t.String()
			}),
			response: t.Object(
				{
					username: t.String(),
					password: t.String(),
					id: t.String(),
					name: t.String()
				},
				{ description: 'sample description' }
			)
		}
	)
	.listen(3000)
```

Then go to `http://localhost:3000/openapi`.

## Type-based references (experimental)

`fromTypes` derives documentation from an exported Elysia instance's TypeScript
types. It returns a synchronous callback for `references`:

```typescript
import { Elysia } from 'elysia'
import { openapi } from '@elysia/openapi'
import { fromTypes } from '@elysia/openapi/gen'

export const app = new Elysia()
	.use(
		openapi({
			references: fromTypes('src/index.ts', { instanceName: 'app' })
		})
	)
	.get('/users', () => [{ id: '1', name: 'Alice' }])
```

Install `typescript` in the environment that generates the references. A `.ts` or
`.tsx` input is compiled to declarations using TypeScript; a prebuilt `.d.ts` is
read directly. File inputs require Node.js or Bun. You can also pass an
object-shaped route type literal without compiling a file:

```typescript
const references = fromTypes(`{
	users: { get: { response: { 200: { id: string; name: string }[] } } }
}`)
```

Relative input paths and `tsconfigPath` resolve from `projectRoot`, which defaults
to the current working directory. The default input is `src/index.ts`, and the
default config is `tsconfig.json`. The selected config's relative `extends` and
path mappings retain their normal TypeScript resolution. Set `instanceName` when
the file contains multiple Elysia instances.

Generation extends that config with declaration-only output defaults.
`compilerOptions` overrides those defaults; configured `rootDir`, `declarationDir`
and `noEmitOnError` are respected. Without an explicit `rootDir`, sibling source
packages can share TypeScript's inferred source root. Output discovery follows
TypeScript's emitted files. `overrideOutputPath` can instead select a declaration:
relative strings resolve under the temporary `dist` directory, absolute strings
are used directly, and callbacks receive the temporary root.

Imported aliases, re-exports and supported type expressions are resolved through
TypeScript. Nested route intersections are traversed independently so that all
paths and methods are retained. `Date` becomes a string with `format: 'date-time'`.
Types that cannot be resolved or represented, including recursive or unsupported
type expressions, become `unknown` (an unconstrained schema) with a diagnostic;
type-derived references do not change runtime validation.

Use `debug: true` to retain the generated config and declarations. A custom
`tmpRoot` must be a dedicated scratch directory: compilation clears it first,
and it is normally removed afterward. `silent: true` suppresses routine compiler
and unresolved-type diagnostics; generation failures can still report errors.

# config

## enabled

@default true
Enable/Disable the plugin

## openapiVersion

@default '3.1.2'

OpenAPI document version to emit. Supports OpenAPI `3.0.x` and `3.1.x`.

## documentation

OpenAPI documentation information

@see https://spec.openapis.org/oas/latest.html

## exclude

Configuration to exclude paths or methods from documentation

## exclude.methods

List of methods to exclude from documentation

## exclude.paths

List of paths to exclude from documentation

## exclude.staticFile

@default true

Exclude static file routes from documentation

## exclude.tags

List of tags to exclude from documentation

## path

@default '/openapi'

The endpoint to expose OpenAPI documentation frontend

## provider

@default 'scalar'

OpenAPI documentation frontend between:

- [Scalar](https://github.com/scalar/scalar)
- [SwaggerUI](https://github.com/swagger-api/swagger-ui)
- null: disable frontend

## references

Additional OpenAPI reference for each endpoint

## scalar

Scalar configuration, refers to [Scalar config](https://github.com/scalar/scalar/blob/main/documentation/configuration.md)

## specPath

@default '/${path}/json'

The endpoint to expose OpenAPI specification in JSON format

## swagger

Swagger config, refers to [Swagger config](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/)

See [documentation](https://elysiajs.com/plugins/openapi.html) for more details.
