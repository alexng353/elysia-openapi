import { TypeBox } from '@sinclair/typemap'
import type { AdditionalReference } from '../types'

const matchRoute = /: Elysia<(.*)>/gs
// Only match standalone numeric keys (not digits embedded in identifiers like v4)
const numberKey = /(?<=^|[{;,\s])(\d+):/g

export interface OpenAPIGeneratorOptions {
	/**
	 * Path to tsconfig.json
	 * @default tsconfig.json
	 */
	tsconfigPath?: string

	/**
	 * Name of the Elysia instance
	 *
	 * If multiple instances are found,
	 * instanceName should be provided
	 */
	instanceName?: string

	/**
	 * Project root directory
	 *
	 * @default process.cwd()
	 */
	projectRoot?: string

	/**
	 * Override output path
	 *
	 * Under any circumstance, that Elysia failed to find a correct schema,
	 * Put your own schema in this path
	 */
	overrideOutputPath?: string | ((tempDir: string) => string)

	/**
	 * don't remove temporary files
	 * for debugging purpose
	 * @default false
	 */
	debug?: boolean

	/**
	 * compilerOptions
	 *
	 * Override tsconfig.json compilerOptions
	 */
	compilerOptions?: Record<string, any>

	/**
	 * Temporary root
	 *
	 * a folder where temporary files are stored
	 * @default os.tmpdir()/.ElysiaAutoOpenAPI
	 *
	 * ! be careful that the folder will be removed after the process ends
	 */
	tmpRoot?: string

	/**
	 * disable log
	 * @default false
	 */
	silent?: boolean
}

/**
 * Polyfill path join for environments without Node.js path module
 */
const join = (...parts: string[]) => parts.join('/').replace(/\/{1,}/g, '/')

export function extractRootObjects(code: string) {
	const results = []
	let i = 0

	while (i < code.length) {
		// find the next colon
		const colonIdx = code.indexOf(':', i)
		if (colonIdx === -1) break

		// walk backwards from colon to find start of key
		let keyEnd = colonIdx - 1
		while (keyEnd >= 0 && /\s/.test(code[keyEnd])) keyEnd--

		let keyStart = keyEnd
		// keep going back until we hit a delimiter (whitespace, brace, semicolon, comma, or start of file)
		while (keyStart >= 0 && !/[\s{};,\n]/.test(code[keyStart])) {
			keyStart--
		}

		// find the opening brace after colon
		const braceIdx = code.indexOf('{', colonIdx)
		if (braceIdx === -1) break

		// scan braces
		let depth = 0
		let end = braceIdx
		for (; end < code.length; end++) {
			if (code[end] === '{') depth++
			else if (code[end] === '}') {
				depth--
				if (depth === 0) {
					end++ // move past closing brace
					break
				}
			}
		}

		results.push(`{${code.slice(keyStart + 1, end)};}`)

		i = end
	}

	return results
}

/**
 * Extract type alias and interface definitions from a declaration string
 * and return a map of name -> body (e.g. `User` -> `{ id: string; name: string; }`).
 *
 * Captures both `type X = ...` and `interface X { ... }` so identifiers
 * declared as interfaces (common in generated clients) get inlined the
 * same way as type aliases. Without this, interface references reach
 * TypeBox unresolved and emit bare `{ $ref: "X" }` schemas.
 */
export function extractTypeAliases(declaration: string): Record<string, string> {
	const aliases: Record<string, string> = {}

	const stripComments = (s: string) =>
		s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

	// Match `type X = ...`
	const typePattern = /\btype\s+(\w+)\s*=\s*/g
	let match: RegExpExecArray | null

	while ((match = typePattern.exec(declaration)) !== null) {
		const name = match[1]
		const startIdx = match.index + match[0].length

		// Fast path: object-body aliases use balanced `{}` scanning to avoid
		// stopping at `;` inside the object literal.
		if (declaration[startIdx] === '{') {
			let depth = 0
			let end = startIdx
			for (; end < declaration.length; end++) {
				if (declaration[end] === '{') depth++
				else if (declaration[end] === '}') {
					depth--
					if (depth === 0) {
						end++
						break
					}
				}
			}
			aliases[name] = stripComments(declaration.slice(startIdx, end))
			continue
		}

		// Non-object bodies (e.g. `Record<string, number>`, `Foo | Bar`): scan
		// to the top-level `;` while tracking generic/array/paren/brace depth.
		let depth = 0
		let end = startIdx
		for (; end < declaration.length; end++) {
			const c = declaration[end]
			if (c === '{' || c === '[' || c === '<' || c === '(') depth++
			else if (c === '}' || c === ']' || c === '>' || c === ')') {
				if (depth === 0) break
				depth--
			} else if ((c === ';' || c === '\n') && depth === 0) break
		}

		const body = stripComments(declaration.slice(startIdx, end)).trim()
		// Skip `typeof X` aliases. TypeBox can't resolve them, and they
		// tend to match too broadly (e.g. `type App = typeof app`).
		if (body && !/^typeof\b/.test(body)) aliases[name] = body
	}

	// Match `interface X ... { ... }` (with optional generics + extends clause)
	const interfacePattern = /\binterface\s+(\w+)\b/g

	while ((match = interfacePattern.exec(declaration)) !== null) {
		const name = match[1]
		// Don't overwrite an existing alias of the same name; the type
		// alias body already won.
		if (aliases[name]) continue

		// Walk forward to the opening `{` of the body, skipping generics
		// and any `extends ...` clause. Any `{` we hit before that is a
		// generic-default object literal, so track depth accordingly.
		let i = match.index + match[0].length
		let genericDepth = 0
		let bodyStart = -1
		for (; i < declaration.length; i++) {
			const c = declaration[i]
			if (c === '<') genericDepth++
			else if (c === '>') genericDepth--
			else if (c === '{' && genericDepth === 0) {
				bodyStart = i
				break
			}
		}
		if (bodyStart === -1) continue

		let depth = 0
		let end = bodyStart
		for (; end < declaration.length; end++) {
			if (declaration[end] === '{') depth++
			else if (declaration[end] === '}') {
				depth--
				if (depth === 0) {
					end++
					break
				}
			}
		}

		aliases[name] = stripComments(declaration.slice(bodyStart, end))
	}

	return aliases
}

/**
 * Web API globals (`Response`, `File`, `Blob`, `FormData`, `ReadableStream`)
 * cannot be inlined as JSON Schema. Replace any `{ $ref: "<global>" }`
 * leftover from TypeBox with an OpenAPI-friendly equivalent so Scalar
 * can render the operation instead of showing an empty panel.
 *
 * Routes that genuinely return a streaming or binary `Response` map to
 * an opaque schema (`{}`) and routes that accept a `File` map to a
 * binary string. Same shape OpenAPI uses for binary uploads.
 */
const WEB_API_GLOBAL_SCHEMAS: Record<string, Record<string, unknown>> = {
	Response: {},
	ReadableStream: {},
	File: { type: 'string', format: 'binary' },
	Blob: { type: 'string', format: 'binary' },
	FormData: { type: 'object' }
}

export function transformWebApiGlobals(schema: any): any {
	if (!schema || typeof schema !== 'object') return schema
	if (Array.isArray(schema)) return schema.map(transformWebApiGlobals)

	if (typeof schema.$ref === 'string' && schema.$ref in WEB_API_GLOBAL_SCHEMAS) {
		return { ...WEB_API_GLOBAL_SCHEMAS[schema.$ref] }
	}

	const out: any = { ...schema }
	if (schema.properties && typeof schema.properties === 'object') {
		out.properties = Object.fromEntries(
			Object.entries(schema.properties).map(([k, v]) => [
				k,
				transformWebApiGlobals(v)
			])
		)
	}
	if (schema.items) out.items = transformWebApiGlobals(schema.items)
	if (
		schema.additionalProperties &&
		typeof schema.additionalProperties === 'object'
	) {
		out.additionalProperties = transformWebApiGlobals(
			schema.additionalProperties
		)
	}
	for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
		if (Array.isArray(schema[key])) {
			out[key] = schema[key].map(transformWebApiGlobals)
		}
	}
	return out
}

/**
 * Replace type references with their inlined definitions so that
 * TypeBox can produce concrete schemas instead of unresolvable $refs
 */
/**
 * @sinclair/typemap emits `{ type: 'Date' }` for TypeScript `Date` types,
 * which is invalid OpenAPI. Rewrite those nodes to the standard
 * `{ type: 'string', format: 'date-time' }` form.
 */
export function transformDateTypes(schema: any): any {
	if (!schema || typeof schema !== 'object') return schema
	if (Array.isArray(schema)) return schema.map(transformDateTypes)

	if (schema.type === 'Date') {
		return { type: 'string', format: 'date-time' }
	}

	const out: any = { ...schema }
	if (schema.properties && typeof schema.properties === 'object') {
		out.properties = Object.fromEntries(
			Object.entries(schema.properties).map(([k, v]) => [
				k,
				transformDateTypes(v)
			])
		)
	}
	if (schema.items) out.items = transformDateTypes(schema.items)
	if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
		out.additionalProperties = transformDateTypes(schema.additionalProperties)
	}
	for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
		if (Array.isArray(schema[key])) {
			out[key] = schema[key].map(transformDateTypes)
		}
	}
	return out
}

export function inlineTypeReferences(
	code: string,
	aliases: Record<string, string>
): string {
	// Sort by name length descending to avoid partial replacements
	const names = Object.keys(aliases).sort((a, b) => b.length - a.length)
	// Iterate until stable so aliases that reference other aliases are
	// fully inlined. Cap rounds to avoid infinite loops on self-refs.
	for (let round = 0; round < 5; round++) {
		let changed = false
		for (const name of names) {
			const body = aliases[name]
			// Skip if the replacement body would reintroduce the name.
			// Keeps us from flipping back and forth on self-referential aliases.
			if (new RegExp(`\\b${name}\\b`).test(body)) continue
			const re = new RegExp(`\\b${name}\\b`, 'g')
			if (!re.test(code)) continue
			const next = code.replace(re, body)
			if (next !== code) {
				code = next
				changed = true
			}
		}
		if (!changed) break
	}
	return code
}

// Built-in / lowercase type names that TypeBox handles natively.
// Bare identifiers NOT in this set and NOT in typeAliases are assumed
// unresolvable and get stripped from unions.
const BUILTIN_TYPES = new Set([
	'string',
	'number',
	'boolean',
	'null',
	'undefined',
	'unknown',
	'any',
	'void',
	'never',
	'object',
	'Date',
	'Record',
	'Array',
	'Promise',
	'Partial',
	'Required',
	'Pick',
	'Omit',
	'Readonly',
	'ReturnType',
	'Awaited',
	'NonNullable',
	'Exclude',
	'Extract',
	'JSX'
])

/**
 * When a union contains a bare identifier that can't be resolved
 * (not in typeAliases, not a builtin, not a generic param), drop it.
 * This lets TypeBox emit a schema for the remaining members instead
 * of failing on the whole response.
 *
 * Example: `ResponseMapStringStringData | { key: null }` where
 * `ResponseMapStringStringData` wasn't inlined becomes `{ key: null }`.
 */
export function stripUnresolvedUnionMembers(
	code: string,
	typeAliases: Record<string, string>
): string {
	const isResolvable = (member: string): boolean => {
		const trimmed = member.trim()
		// Literal shapes, arrays, tuples, quoted strings, numbers, booleans are fine
		if (!/^[A-Za-z_]/.test(trimmed)) return true
		// Strip generic args / array suffix / indexers for the name check
		const name = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1]
		if (!name) return true
		if (BUILTIN_TYPES.has(name)) return true
		if (typeAliases[name]) return true
		// Lowercase first letter -> likely a value, param, or primitive-like
		if (name[0] === name[0].toLowerCase()) return true
		return false
	}

	// Split a union at top level (depth 0 for {}, [], <>, ())
	const splitUnion = (text: string): string[] => {
		const parts: string[] = []
		let depth = 0
		let start = 0
		for (let i = 0; i < text.length; i++) {
			const c = text[i]
			if (c === '{' || c === '[' || c === '<' || c === '(') depth++
			else if (c === '}' || c === ']' || c === '>' || c === ')') depth--
			else if (c === '|' && depth === 0) {
				parts.push(text.slice(start, i))
				start = i + 1
			}
		}
		parts.push(text.slice(start))
		return parts
	}

	// Only process the `response:` value bodies. Walk the string, find
	// each `response:` key, capture its value up to the matching closer,
	// rewrite union members inside, and splice back.
	const RESPONSE_RE = /\bresponse\s*:\s*/g
	let out = ''
	let cursor = 0
	let match: RegExpExecArray | null
	while ((match = RESPONSE_RE.exec(code)) !== null) {
		const valueStart = match.index + match[0].length
		// Find value end: stop at top-level `;` or `,` or `}`
		let depth = 0
		let valueEnd = valueStart
		for (let i = valueStart; i < code.length; i++) {
			const c = code[i]
			if (c === '{' || c === '[' || c === '<' || c === '(') depth++
			else if (c === '}' || c === ']' || c === '>' || c === ')') {
				if (depth === 0) {
					valueEnd = i
					break
				}
				depth--
			} else if ((c === ';' || c === ',') && depth === 0) {
				valueEnd = i
				break
			}
		}

		const value = code.slice(valueStart, valueEnd)
		// Inside the response value is { 200: X; 422: Y; ... }. Rewrite the
		// X / Y type expressions. Simplest: split by `|` at top level and
		// drop unresolvable members.
		const rewritten = value.replace(
			/(\d+\s*:\s*)([^;]+?)(?=\s*[;}])/g,
			(_, prefix: string, typeExpr: string) => {
				const members = splitUnion(typeExpr)
				const kept = members.filter(isResolvable)
				if (kept.length === 0 || kept.length === members.length) {
					return prefix + typeExpr
				}
				return prefix + kept.join(' | ')
			}
		)

		out += code.slice(cursor, valueStart) + rewritten
		cursor = valueEnd
	}
	out += code.slice(cursor)
	return out
}

/**
 * Rewrite object literals whose only member is an index signature
 * `{ [k: string]: T }` into `Record<string, T>`. TypeBox's syntax
 * parser emits `never` for raw index signatures, which cascades up
 * the tree and causes the whole route to be dropped. Only pure
 * index-only bodies are rewritten; objects with extra properties
 * are left alone.
 */
export function rewriteIndexSignatures(code: string): string {
	// Scan for `{` openings, then check whether the body is solely an
	// index signature. We walk the string and substitute in place.
	let out = ''
	let i = 0
	while (i < code.length) {
		if (code[i] !== '{') {
			out += code[i]
			i++
			continue
		}
		// Find the matching `}`
		let depth = 0
		let end = i
		for (; end < code.length; end++) {
			if (code[end] === '{') depth++
			else if (code[end] === '}') {
				depth--
				if (depth === 0) {
					end++
					break
				}
			}
		}
		const body = code.slice(i + 1, end - 1)
		// Match `[name: KEY]: VALUE` where VALUE may contain balanced
		// braces/brackets/angles/parens (for things like `Array<...>` or
		// nested `{ ... }`). Trailing `;` / `,` optional.
		const idxMatch = body.match(
			/^\s*\[\s*\w+\s*:\s*([^\]]+?)\s*\]\s*:\s*/
		)
		if (!idxMatch) {
			out += '{'
			i++
			continue
		}
		// Capture the value expression with depth-tracking
		const valueStart = idxMatch[0].length
		let vDepth = 0
		let vEnd = valueStart
		for (; vEnd < body.length; vEnd++) {
			const c = body[vEnd]
			if (c === '{' || c === '[' || c === '<' || c === '(') vDepth++
			else if (c === '}' || c === ']' || c === '>' || c === ')') {
				if (vDepth === 0) break
				vDepth--
			} else if ((c === ';' || c === ',') && vDepth === 0) break
		}
		const value = body.slice(valueStart, vEnd).trim()
		// Ensure nothing else follows besides whitespace / trailing punct
		const rest = body.slice(vEnd).replace(/^[;,\s]+/, '').trim()
		if (rest.length > 0) {
			out += '{'
			i++
			continue
		}
		// Recursively rewrite inside the value
		const rewrittenValue = rewriteIndexSignatures(value)
		out += `Record<string, ${rewrittenValue}>`
		i = end
	}
	return out
}

/**
 * Scan a declaration for `import("...").TypeName` references,
 * use TypeScript's module resolution to find the source files,
 * and extract the type aliases from them.
 *
 * This allows TypeBox to produce concrete schemas for cross-module types
 * (e.g. Drizzle ORM types imported from another package).
 */
export function resolveImportedTypes(
	declaration: string,
	projectRoot: string,
	tsconfigPath: string,
	sourceFilePath: string,
	existingAliases: Record<string, string>,
	fs: {
		existsSync: (path: string) => boolean
		readFileSync: (path: string, encoding: BufferEncoding) => string
	}
): Record<string, string> {
	const aliases = { ...existingAliases }

	// Collect all import("...").TypeName references
	const importPattern = /import\("([^"]+)"\)\.(\w+)/g
	const imports = new Map<string, Set<string>>()
	let match: RegExpExecArray | null

	while ((match = importPattern.exec(declaration)) !== null) {
		const [, modulePath, typeName] = match
		if (aliases[typeName]) continue // already resolved
		if (!imports.has(modulePath)) imports.set(modulePath, new Set())
		imports.get(modulePath)!.add(typeName)
	}

	if (imports.size === 0) return aliases

	let ts: typeof import('typescript')
	try {
		ts = require('typescript')
	} catch {
		throw new Error(
			'@elysiajs/openapi: typescript is required to resolve import() type references. ' +
			'Install it with: bun add -d typescript'
		)
	}

	let compilerOptions: Record<string, any> = {}
	const fullTsconfigPath = tsconfigPath.startsWith('/')
		? tsconfigPath
		: join(projectRoot, tsconfigPath)

	if (fs.existsSync(fullTsconfigPath)) {
		const configFile = ts.readConfigFile(fullTsconfigPath, (path) =>
			fs.readFileSync(path, 'utf8')
		)
		if (configFile.config) {
			const parsed = ts.parseJsonConfigFileContent(
				configFile.config,
				ts.sys,
				projectRoot
			)
			compilerOptions = parsed.options
		}
	}

	for (const [modulePath] of imports) {
		let resolvedFile: string | undefined

		// Use TypeScript's module resolution (handles paths, exports, monorepos)
		// Resolve relative to the source file so workspace package symlinks work
		const containingFile = sourceFilePath.startsWith('/')
			? sourceFilePath
			: join(projectRoot, sourceFilePath)
		const resolved = ts.resolveModuleName(
			modulePath,
			containingFile,
			compilerOptions,
			ts.sys
		)
		const fileName =
			resolved.resolvedModule?.resolvedFileName
		if (fileName && fs.existsSync(fileName)) {
			resolvedFile = fileName
		}

		if (!resolvedFile) continue

		try {
			const source = fs.readFileSync(resolvedFile, 'utf8')
			const moduleAliases = extractTypeAliases(source)

			// Pull every alias from the resolved module, not just the
			// requested typeNames. The requested names often reference
			// other aliases declared in the same file (e.g. a
			// `ResponseFoo` interface whose body references
			// `ResponseFooData`); without those, inlineTypeReferences
			// stops one level deep and TypeBox emits bare $ref schemas
			// for the nested identifiers.
			for (const [name, body] of Object.entries(moduleAliases)) {
				if (!aliases[name]) aliases[name] = body
			}
		} catch {
			// Skip unreadable files
		}
	}

	return aliases
}

/**
 * Flatten nested intersections so that each root object represents a single route.
 *
 * Multi-route Elysia plugins produce declarations like:
 *   { api: { v3: { a: {...} } & { b: {...} } } }
 *
 * This distributes the outer structure over the inner intersection:
 *   { api: { v3: { a: {...} } } } & { api: { v3: { b: {...} } } }
 *
 * This way `extractRootObjects` and TypeBox can process each route individually.
 */
export function flattenNestedIntersections(declaration: string): string {
	// Repeatedly flatten until no nested intersections remain.
	// Deduplicate after each round: when sibling properties each contain
	// intersections, naive distribution cross-products them and generates
	// many copies of the same leaf route. Without dedup, real BFFs with
	// dozens of routes can blow up to tens of thousands of duplicate
	// top-level terms, sending the inlining + TypeBox pass into a
	// minutes-long loop. Dedup keeps the output linear in the number of
	// distinct routes.
	//
	// Hard caps (round count, total output size) prevent runaway memory
	// growth on adversarial nesting where every leaf is unique. If the
	// cap trips, fall back to the pre-round result. Real apps stabilize
	// after a few rounds well below these limits.
	const MAX_ROUNDS = 50
	const MAX_OUTPUT_LENGTH = 8 * 1024 * 1024
	let result = declaration
	let changed = true
	let rounds = 0

	while (changed && rounds++ < MAX_ROUNDS) {
		changed = false
		const parts = splitAtTopLevelIntersections(result)
		const flattened: string[] = []
		const seen = new Set<string>()

		for (const part of parts) {
			const expanded = expandOneLevel(part)
			if (expanded.length > 1) changed = true
			for (const item of expanded) {
				if (seen.has(item)) continue
				seen.add(item)
				flattened.push(item)
			}
		}

		const next = flattened.join(' & ')
		if (next.length > MAX_OUTPUT_LENGTH) break
		result = next
	}

	return result
}

/**
 * Split a declaration string at top-level `& ` boundaries (brace-aware).
 */
function splitAtTopLevelIntersections(decl: string): string[] {
	const parts: string[] = []
	let depth = 0
	let start = 0

	for (let i = 0; i < decl.length; i++) {
		const ch = decl[i]
		if (ch === '{') depth++
		else if (ch === '}') depth--
		else if (depth === 0 && ch === '&') {
			parts.push(decl.slice(start, i).trim())
			start = i + 1
		}
	}

	const last = decl.slice(start).trim()
	if (last) parts.push(last)
	return parts.filter(Boolean)
}

/**
 * Given a single object string like `{ api: { v3: { a: 1 } & { b: 2 }; }; }`,
 * find the deepest nested intersection and distribute the parent over it.
 * Returns multiple strings if an intersection was found, or the original string if not.
 */
function expandOneLevel(obj: string): string[] {
	// Find `} & {` at the deepest nesting level
	let bestIdx = -1
	let bestDepth = -1
	let depth = 0

	for (let i = 0; i < obj.length - 4; i++) {
		const ch = obj[i]
		if (ch === '{') depth++
		else if (ch === '}') {
			depth--
			// Check for `} & {` pattern
			const rest = obj.slice(i)
			const m = rest.match(/^\}\s*&\s*\{/)
			if (m && depth > bestDepth) {
				bestIdx = i
				bestDepth = depth
			}
		}
	}

	if (bestIdx === -1) return [obj]

	// Find the enclosing property — walk backwards from the `} & {` to find
	// the opening `{` at the same depth that starts this intersection group.
	// Then walk forward to find all `& {` members.

	// Find the start of the intersection group: the `{` that opened the first member.
	// We start from `bestIdx` (the `}` in `} & {`). That `}` closes the first member,
	// so depth starts at 1 (we're "inside" one closing brace) and we look for
	// the `{` that brings depth back to 0.
	let groupStart = -1
	depth = 1
	for (let i = bestIdx - 1; i >= 0; i--) {
		if (obj[i] === '}') depth++
		else if (obj[i] === '{') {
			depth--
			if (depth === 0) {
				groupStart = i
				break
			}
		}
	}

	if (groupStart === -1) return [obj]

	// Find the end of the intersection group: scan forward from groupStart
	// collecting all `{ ... } & { ... } & { ... }` members
	const members: string[] = []
	let pos = groupStart
	while (pos < obj.length) {
		if (obj[pos] !== '{') break
		// Find matching close brace
		depth = 0
		let end = pos
		for (; end < obj.length; end++) {
			if (obj[end] === '{') depth++
			else if (obj[end] === '}') {
				depth--
				if (depth === 0) { end++; break }
			}
		}
		members.push(obj.slice(pos, end))
		pos = end
		// Skip ` & ` separator
		const sep = obj.slice(pos).match(/^\s*&\s*/)
		if (sep) pos += sep[0].length
		else break
	}

	if (members.length <= 1) return [obj]

	// The prefix is everything before groupStart, suffix is everything after the group
	const prefix = obj.slice(0, groupStart)
	const suffix = obj.slice(pos)

	// Distribute: for each member, wrap with prefix + suffix
	return members.map((member) => prefix + member + suffix)
}

export function declarationToJSONSchema(
	declaration: string,
	typeAliases?: Record<string, string>
) {
	const routes: AdditionalReference = {}

	// Flatten nested intersections (from multi-route plugins) so each
	// root object represents a single route path
	const flattened = flattenNestedIntersections(declaration)

	// Treaty is a collection of { ... } & { ... } & { ... }.
	// Even after intersection dedup, extractRootObjects can produce many
	// identical candidate strings when sibling routes share enough
	// structure that distribution generates the same leaf shape multiple
	// times. Deduplicating at this layer turns a per-route inline +
	// TypeBox loop that runs thousands of times into one that runs once
	// per distinct route body.
	const candidates = Array.from(
		new Set(extractRootObjects(flattened.replace(numberKey, '"$1":')))
	)
	for (const route of candidates) {
		let processed = route.replaceAll(/readonly/g, '')

		// Replace import("...").TypeName with just TypeName
		// (the type should already be in typeAliases from resolveImportedTypes)
		processed = processed.replace(
			/import\([^)]*\)\.(\w+)/g,
			'$1'
		)

		// Inline any type aliases so TypeBox resolves them
		if (typeAliases) processed = inlineTypeReferences(processed, typeAliases)

		// Normalize `undefined` to `null` in response types. JSON has no
		// undefined; `null` is the correct wire representation. This lets
		// handlers that return `x ?? undefined` or `field?: T` surface as
		// nullable schemas instead of being dropped by TypeBox.
		processed = processed.replace(/\s*\|\s*undefined\b/g, ' | null')
		processed = processed.replace(/\bundefined\s*\|\s*/g, 'null | ')
		processed = processed.replace(/:\s*undefined\b/g, ': null')

		// Strip unresolvable named type members from unions.
		// When a union contains an identifier that couldn't be inlined
		// (e.g. a type from a third-party package the generator couldn't
		// resolve), drop that member so TypeBox can still emit a schema
		// for the remaining literal members.
		processed = stripUnresolvedUnionMembers(processed, typeAliases ?? {})

		// Rewrite pure index signatures `{ [k: string]: T }` to
		// `Record<string, T>` which TypeBox handles. The index key may be
		// `string`, `number`, or a template literal; without this, TypeBox
		// emits `never` for the whole object and drops the route.
		processed = rewriteIndexSignatures(processed)

		// TypeBox can't evaluate `ReturnType<typeof fn>` or bare `typeof fn`
		// (the function body isn't in the type-only declaration). Replace
		// with `unknown` so the surrounding schema still resolves rather
		// than dropping the route entirely.
		processed = processed.replace(
			/\bReturnType\s*<\s*typeof\s+\w+\s*>/g,
			'unknown'
		)
		processed = processed.replace(/\btypeof\s+\w+/g, 'unknown')

		let schema = TypeBox(processed)
		schema = transformDateTypes(schema)
		schema = transformWebApiGlobals(schema)
		if (schema.type !== 'object') continue

		const paths = []

		while (true) {
			const keys = Object.keys(schema.properties)
			if (keys.length !== 1) break

			paths.push(keys[0])

			schema = schema.properties[keys[0]] as any
			if (!schema?.properties) break
		}

		const method = paths.pop()!
		// For whatever reason, if failed to infer route correctly
		if (!method) continue

		const path = '/' + paths.join('/')
		schema = schema.properties

		if (schema?.response?.type === 'object') {
			const responseSchema: Record<string, any> = {}

			for (const key in schema.response.properties)
				responseSchema[key] = schema.response.properties[key]

			schema.response = responseSchema
		}

		if (!routes[path]) routes[path] = {}
		// @ts-ignore
		routes[path][method.toLowerCase()] = schema
	}

	return routes
}

/**
 * Extract the Nth (0-indexed) top-level generic parameter from
 * a string that starts with `: Elysia<...>` or `Elysia<...>`.
 *
 * Tracks `<>`, `{}`, `[]`, `()` depth so that commas inside
 * nested generics or object literals are not counted as separators.
 */
export function extractGenericParam(
	instance: string,
	paramIndex: number
): string | undefined {
	// Find the opening `<` of the Elysia generic
	const openAngle = instance.indexOf('<')
	if (openAngle === -1) return undefined

	let depth = 0
	let currentParam = 0
	let paramStart = openAngle + 1

	for (let i = openAngle + 1; i < instance.length; i++) {
		const ch = instance[i]

		if (ch === '<' || ch === '{' || ch === '[' || ch === '(') {
			depth++
		} else if (ch === '>' || ch === '}' || ch === ']' || ch === ')') {
			if (depth === 0) {
				// We've hit the closing `>` of the Elysia generic
				if (currentParam === paramIndex) {
					return instance.slice(paramStart, i).trim()
				}
				return undefined // param index out of range
			}
			depth--
		} else if (ch === ',' && depth === 0) {
			if (currentParam === paramIndex) {
				return instance.slice(paramStart, i).trim()
			}
			currentParam++
			paramStart = i + 1
		}
	}

	return undefined
}

/**
 * Auto generate OpenAPI schema from Elysia instance
 *
 * It's expected that this command should run in project root
 *
 * @experimental use at your own risk
 */
export const fromTypes =
	(
		/**
		 * Path to file where Elysia instance is
		 *
		 * The path must export an Elysia instance
		 * or a literal TypeScript declaration
		 */
		targetFilePath = 'src/index.ts',
		{
			tsconfigPath = 'tsconfig.json',
			instanceName,
			projectRoot = process.cwd(),
			overrideOutputPath,
			debug = false,
			compilerOptions,
			tmpRoot,
			silent = false
		}: OpenAPIGeneratorOptions = {}
	) =>
	() => {
		// targetFilePath is an actual TypeScript declaration
		if (
			targetFilePath.trimStart().startsWith('{') &&
			targetFilePath.trimEnd().endsWith('}')
		)
			return declarationToJSONSchema(targetFilePath)

		if (
			typeof process === 'undefined' ||
			typeof process.getBuiltinModule !== 'function'
		)
			throw new Error(
				'[@elysiajs/openapi/gen] `fromTypes` from file path is only available in Node.js/Bun environment or environments'
			)

		const fs = process.getBuiltinModule('fs')
		if (!fs)
			throw new Error(
				'[@elysiajs/openapi/gen] `fromTypes` require `fs` module which is not available in this environment'
			)

		try {
			if (
				!targetFilePath.endsWith('.ts') &&
				!targetFilePath.endsWith('.tsx')
			)
				throw new Error('Only .ts files are supported')

			if (targetFilePath.startsWith('./'))
				targetFilePath = targetFilePath.slice(2)

			let src = targetFilePath.startsWith('/')
				? targetFilePath
				: join(projectRoot, targetFilePath)

			if (!fs.existsSync(src))
				throw new Error(
					`Couldn't find "${targetFilePath}" from ${projectRoot}`
				)

			let targetFile: string

			if (!tmpRoot) {
				const os = process.getBuiltinModule('os')

				tmpRoot = join(
					os && typeof os.tmpdir === 'function'
						? os.tmpdir()
						: projectRoot,
					'.ElysiaAutoOpenAPI'
				)
			}

			// Since it's already a declaration file
			// We can just read it directly
			if (targetFilePath.endsWith('.d.ts')) targetFile = targetFilePath
			else {
				if (fs.existsSync(tmpRoot))
					fs.rmSync(tmpRoot, { recursive: true, force: true })

				fs.mkdirSync(tmpRoot, { recursive: true })

				const tsconfig = tsconfigPath.startsWith('/')
					? tsconfigPath
					: join(projectRoot, tsconfigPath)

				let extendsRef = fs.existsSync(tsconfig)
					? `"extends": "${join(projectRoot, 'tsconfig.json')}",`
					: ''

				let distDir = join(tmpRoot, 'dist')

				// Convert Windows path to Unix for TypeScript CLI
				if (
					typeof process !== 'undefined' &&
					process.platform === 'win32'
				) {
					extendsRef = extendsRef.replace(/\\/g, '/')
					src = src.replace(/\\/g, '/')
					distDir = distDir.replace(/\\/g, '/')
				}

				fs.writeFileSync(
					join(tmpRoot, 'tsconfig.json'),
					`{
	${extendsRef}
	"compilerOptions": ${
		compilerOptions
			? JSON.stringify(compilerOptions)
			: `{
	"lib": ["ESNext"],
	"module": "ESNext",
	"noEmit": false,
	"declaration": true,
	"emitDeclarationOnly": true,
	"moduleResolution": "bundler",
	"skipLibCheck": true,
	"skipDefaultLibCheck": true,
	"rootDir": "${projectRoot}",
	"outDir": "${distDir}",
	"composite": false,
	"incremental": false,
	"tsBuildInfoFile": null
}`
	},
	"include": ["${src}"],
	"exclude": ["**/node_modules"]
}`
				)

				const child_process = process.getBuiltinModule('child_process')
				if (!child_process)
					throw new Error(
						'[@elysiajs/openapi/gen] `fromTypes` declaration generation require `child_process` module which is not available in this environment'
					)
				const { spawnSync } = child_process
				if (typeof spawnSync !== 'function')
					throw new Error(
						'[@elysiajs/openapi/gen] `fromTypes` declaration generation require child_process.spawnSync which is not available in this environment'
					)

				// Resolve `tsc` from the user's local node_modules/.bin so
				// this works in Bun test / Node environments where PATH may
				// not include the local bin dir. Fall back to `tsc` on PATH.
				const localTsc = join(
					projectRoot,
					'node_modules',
					'.bin',
					process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
				)
				const tscBin = fs.existsSync(localTsc) ? localTsc : 'tsc'

				spawnSync(tscBin, {
					shell: true,
					cwd: tmpRoot,
					stdio: silent ? undefined : 'inherit'
				})

				const fileName = targetFilePath
					.replace(/.tsx$/, '.ts')
					.replace(/.ts$/, '.d.ts')

				targetFile =
					(overrideOutputPath
						? typeof overrideOutputPath === 'string'
							? overrideOutputPath.startsWith('/')
								? overrideOutputPath
								: join(tmpRoot, 'dist', overrideOutputPath)
							: overrideOutputPath(tmpRoot)
						: undefined) ??
					join(
						tmpRoot,
						'dist',
						// remove leading like src or something similar
						fileName.slice(fileName.indexOf('/') + 1)
					)

				let existed = fs.existsSync(targetFile)

				if (!existed && !overrideOutputPath) {
					targetFile = join(
						tmpRoot,
						'dist',
						// use original file name as-is eg. in monorepo
						fileName
					)

					existed = fs.existsSync(targetFile)
				}

				if (!existed) {
					fs.rmSync(join(tmpRoot, 'tsconfig.json'))

					console.warn(
						'[@elysiajs/openapi/gen] Failed to generate OpenAPI schema'
					)
					console.warn("Couldn't find generated declaration file")

					if (fs.existsSync(join(tmpRoot, 'dist'))) {
						const tempFiles = fs
							.readdirSync(join(tmpRoot, 'dist'), {
								recursive: true
							})
							.filter((x) => x.toString().endsWith('.d.ts'))
							.map((x) => `- ${x}`)
							.join('\n')

						if (tempFiles) {
							console.warn(
								'You can override with `overrideOutputPath` with one of the following:'
							)
							console.warn(tempFiles)
						}
					} else {
						console.warn(
							"reason: root folder doesn't exists",
							join(tmpRoot, 'dist')
						)
					}

					return
				}
			}

			const declaration = fs.readFileSync(targetFile, 'utf8')

			// Check just in case of race-condition
			if (!debug && fs.existsSync(tmpRoot))
				fs.rmSync(tmpRoot, { recursive: true, force: true })

			// Extract type aliases from the declaration preamble
			// so we can inline them into route schemas
			let typeAliases = extractTypeAliases(declaration)

			// Resolve cross-module import("...").TypeName references
			typeAliases = resolveImportedTypes(
				declaration,
				projectRoot,
				tsconfigPath,
				src,
				typeAliases,
				fs
			)

			let instance = declaration.match(
				instanceName
					? new RegExp(`${instanceName}: Elysia<(.*)`, 'gs')
					: matchRoute
			)?.[0]

			if (!instance) return

			// Get 5th generic parameter (the routes map)
			// Elysia<Prefix, Scoped, Singleton, Definitions, Routes, Metadata, Routes>
			// The params can be any type (string, `any`, objects, etc.),
			// so we must parse by counting commas at depth 0 (brace-aware).
			const routeSection = extractGenericParam(instance, 4)
			if (!routeSection) return

			return declarationToJSONSchema(routeSection, typeAliases)
		} catch (error) {
			console.warn(
				'[@elysiajs/openapi/gen] Failed to generate OpenAPI schema'
			)
			console.warn(error)

			return
		} finally {
			if (!debug && tmpRoot && fs.existsSync(tmpRoot))
				fs.rmSync(tmpRoot, { recursive: true, force: true })
		}
	}
