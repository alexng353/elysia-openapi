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
 * Extract type alias definitions from a declaration string and return
 * a map of name -> body (e.g. `User` -> `{ id: string; name: string; }`)
 */
export function extractTypeAliases(declaration: string): Record<string, string> {
	const aliases: Record<string, string> = {}
	const typePattern = /\btype\s+(\w+)\s*(?:<[^>]*>)?\s*=\s*/g
	let match: RegExpExecArray | null

	while ((match = typePattern.exec(declaration)) !== null) {
		const name = match[1]
		const startIdx = match.index + match[0].length
		const ch = declaration[startIdx]

		if (ch === '{') {
			// Object type: scan for matching `}`
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
			aliases[name] = declaration
				.slice(startIdx, end)
				// Strip single-line comments that would break TypeBox parsing
				.replace(/\/\/[^\n]*/g, '')
				// Strip multi-line comments
				.replace(/\/\*[\s\S]*?\*\//g, '')
		} else {
			// Non-object type (Array<...>, union, primitive, etc.):
			// scan until we hit a semicolon at depth 0, or a newline that
			// ISN'T followed by a union/intersection continuation (| or &).
			let depth = 0
			let end = startIdx
			for (; end < declaration.length; end++) {
				const c = declaration[end]
				if (c === '<' || c === '(' || c === '{' || c === '[') depth++
				else if (c === '>' || c === ')' || c === '}' || c === ']') depth--
				else if (depth === 0 && c === ';') break
				else if (depth === 0 && c === '\n') {
					// Check if the text so far ends with | or & (continuation)
					const soFar = declaration.slice(startIdx, end).trimEnd()
					if (soFar.endsWith('|') || soFar.endsWith('&') || soFar.endsWith('=')) continue

					// Check if the next non-whitespace char is | or & (continuation)
					let peek = end + 1
					while (peek < declaration.length && (declaration[peek] === ' ' || declaration[peek] === '\t' || declaration[peek] === '\n' || declaration[peek] === '\r')) peek++
					if (peek < declaration.length && (declaration[peek] === '|' || declaration[peek] === '&')) continue

					break
				}
			}
			let body = declaration
				.slice(startIdx, end)
				.trim()
				.replace(/\/\/[^\n]*/g, '')
				.replace(/\/\*[\s\S]*?\*\//g, '')
				// Collapse whitespace for cleaner output
				.replace(/\s+/g, ' ')
				.trim()
			// Strip leading `|` or `&` from union/intersection types
			// (TS allows `type X = | "a" | "b"` but TypeBox doesn't)
			if (body.startsWith('|') || body.startsWith('&'))
				body = body.slice(1).trim()
			if (body) aliases[name] = body
		}
	}

	return aliases
}

/**
 * Extract TypeScript `enum` declarations from source code and return
 * a map of enum name -> union of string literal values.
 *
 * Only handles string enums (e.g. `enum X { A = "a", B = "b" }`).
 * Numeric or computed enums are skipped.
 */
export function extractEnums(source: string): Record<string, string> {
	const result: Record<string, string> = {}
	const pattern = /\benum\s+(\w+)\s*\{([^}]*)\}/g
	let match: RegExpExecArray | null

	while ((match = pattern.exec(source)) !== null) {
		const name = match[1]
		const body = match[2]
		const literals: string[] = []
		const memberPattern = /=\s*["']([^"']+)["']/g
		let memberMatch: RegExpExecArray | null
		while ((memberMatch = memberPattern.exec(body)) !== null) {
			literals.push(`"${memberMatch[1]}"`)
		}
		if (literals.length > 0) {
			result[name] = literals.join(' | ')
		}
	}
	return result
}

/**
 * Extract `const X = ["a", "b", "c"] as const` declarations from source code
 * and return a map of name -> union of literal values (e.g. `'"a" | "b" | "c"'`).
 *
 * This allows resolving `(typeof X)[number]` patterns that TypeBox can't handle.
 */
export function extractConstArrays(source: string): Record<string, string> {
	const result: Record<string, string> = {}
	const pattern =
		/\bconst\s+(\w+)\s*=\s*\[([^\]]*)\]\s*as\s+const/g
	let match: RegExpExecArray | null

	while ((match = pattern.exec(source)) !== null) {
		const name = match[1]
		const arrayBody = match[2]
		// Extract string literals from the array body
		const literals: string[] = []
		const litPattern = /["']([^"']+)["']/g
		let litMatch: RegExpExecArray | null
		while ((litMatch = litPattern.exec(arrayBody)) !== null) {
			literals.push(`"${litMatch[1]}"`)
		}
		if (literals.length > 0) {
			result[name] = literals.join(' | ')
		}
	}
	return result
}

/**
 * Replace `(typeof X)[number]` patterns with the resolved union type
 * from const array declarations.
 */
export function resolveTypeofIndexed(
	code: string,
	constArrays: Record<string, string>
): string {
	return code.replace(
		/\(typeof\s+(\w+)\)\s*\[\s*number\s*\]/g,
		(_match, name) => {
			return constArrays[name] ?? _match
		}
	)
}

/**
 * Replace type references with their inlined definitions so that
 * TypeBox can produce concrete schemas instead of unresolvable $refs
 */
export function inlineTypeReferences(
	code: string,
	aliases: Record<string, string>
): string {
	// Sort by name length descending to avoid partial replacements
	const names = Object.keys(aliases).sort((a, b) => b.length - a.length)
	for (const name of names) {
		// Replace standalone type references (not part of another identifier)
		code = code.replace(
			new RegExp(`\\b${name}\\b`, 'g'),
			aliases[name]
		)
	}
	return code
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
): { aliases: Record<string, string>; constArrays: Record<string, string> } {
	const aliases = { ...existingAliases }
	const constArrays: Record<string, string> = {}

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

	if (imports.size === 0) return { aliases, constArrays }

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

	for (const [modulePath, typeNames] of imports) {
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

			// Merge ALL type aliases from the resolved file (not just
			// the ones we're looking for) so sibling types used in
			// their bodies are also available for inlining.
			Object.assign(aliases, moduleAliases)

			// Also extract `const X = [...] as const` declarations
			// so we can resolve `(typeof X)[number]` patterns later
			Object.assign(constArrays, extractConstArrays(source))
			// Extract enums and add them as type aliases
			const enums = extractEnums(source)
			Object.assign(aliases, enums)

			// Check which requested types we still need
			const remaining = new Set<string>()
			for (const typeName of typeNames) {
				if (!aliases[typeName]) remaining.add(typeName)
			}

			// If some types weren't found, follow `export * from "..."` re-exports
			if (remaining.size > 0) {
				const reExportPattern = /export\s+\*\s+from\s+["']([^"']+)["']/g
				let reMatch: RegExpExecArray | null
				while ((reMatch = reExportPattern.exec(source)) !== null) {
					if (remaining.size === 0) break

					const relPath = reMatch[1]
					// Resolve relative to the barrel file's directory
					const barrelDir = resolvedFile.replace(/\/[^/]+$/, '')
					let subFile = join(barrelDir, relPath)
					// Try .ts extension if not present
					if (!subFile.endsWith('.ts') && !subFile.endsWith('.tsx')) {
						if (fs.existsSync(subFile + '.ts')) subFile += '.ts'
						else if (fs.existsSync(subFile + '.tsx')) subFile += '.tsx'
						else if (fs.existsSync(join(subFile, 'index.ts'))) subFile = join(subFile, 'index.ts')
						else continue
					}
					if (!fs.existsSync(subFile)) continue

					try {
						const subSource = fs.readFileSync(subFile, 'utf8')
						const subAliases = extractTypeAliases(subSource)
						Object.assign(aliases, subAliases)
						Object.assign(constArrays, extractConstArrays(subSource))
						Object.assign(aliases, extractEnums(subSource))
						for (const typeName of remaining) {
							if (aliases[typeName]) remaining.delete(typeName)
						}
					} catch {
						// Skip unreadable sub-files
					}
				}
			}
		} catch {
			// Skip unreadable files
		}
	}

	return { aliases, constArrays }
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
	// Recursively flatten nested intersections, processing shallowest first.
	//
	// The previous iterative approach expanded the DEEPEST intersection first,
	// which copied sibling intersections into every expanded member, producing
	// a Cartesian product (M1 × M2 × ... × Mp) that OOMs on large apps.
	//
	// Shallowest-first expansion ensures each member is independent — siblings
	// are NOT copied — giving linear output (M1 + M2 + ... + Mp).
	return flattenParts(splitAtTopLevelIntersections(declaration)).join(' & ')
}

function flattenParts(parts: string[]): string[] {
	const result: string[] = []
	for (const part of parts) {
		const expanded = expandShallowest(part)
		if (expanded.length === 1) {
			result.push(expanded[0])
		} else {
			result.push(...flattenParts(expanded))
		}
	}
	return result
}

/**
 * Find the SHALLOWEST nested `} & {` intersection and distribute the parent
 * over it. Returns multiple strings if an intersection was found, or the
 * original string if not. Each returned member is independent — it does NOT
 * contain sibling intersections from other branches.
 */
function expandShallowest(obj: string): string[] {
	let bestIdx = -1
	let bestDepth = Infinity
	let depth = 0

	for (let i = 0; i < obj.length - 4; i++) {
		const ch = obj[i]
		if (ch === '{') depth++
		else if (ch === '}') {
			depth--
			// Check for `} & {` pattern
			if (
				depth > 0 &&
				depth < bestDepth &&
				obj[i] === '}' &&
				obj.slice(i, i + 10).match(/^\}\s*&\s*\{/)
			) {
				bestIdx = i
				bestDepth = depth
			}
		}
	}

	if (bestIdx === -1) return [obj]

	// Find the start of the intersection group
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

	// Collect all `{ ... } & { ... } & { ... }` members
	const members: string[] = []
	let pos = groupStart
	while (pos < obj.length) {
		if (obj[pos] !== '{') break
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
		const sep = obj.slice(pos).match(/^\s*&\s*/)
		if (sep) pos += sep[0].length
		else break
	}

	if (members.length <= 1) return [obj]

	const prefix = obj.slice(0, groupStart)
	const suffix = obj.slice(pos)

	return members.map((member) => prefix + member + suffix)
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
 * Walk a JSON Schema object and replace bare `$ref` entries
 * (unresolved type names from TypeBox) with an empty schema `{}`.
 *
 * TypeBox outputs `{"$ref": "TypeName"}` for types it can't resolve.
 * These are not valid JSON Schema `$ref` URIs, so we replace them
 * with `{}` (equivalent to `any`) to keep the spec valid.
 */
function replaceBareRefs(obj: any): void {
	if (!obj || typeof obj !== 'object') return
	if (Array.isArray(obj)) {
		for (let i = 0; i < obj.length; i++) {
			if (obj[i]?.$ref && !obj[i].$ref.startsWith('#')) {
				obj[i] = {}
			} else {
				replaceBareRefs(obj[i])
			}
		}
		return
	}
	for (const key of Object.keys(obj)) {
		const val = obj[key]
		if (val?.$ref && !val.$ref.startsWith('#')) {
			obj[key] = {}
		} else if (typeof val === 'object') {
			replaceBareRefs(val)
		}
	}
}

export function declarationToJSONSchema(
	declaration: string,
	typeAliases?: Record<string, string>,
	constArrays?: Record<string, string>
) {
	const routes: AdditionalReference = {}

	// Flatten nested intersections (from multi-route plugins) so each
	// root object represents a single route path
	const flattened = flattenNestedIntersections(declaration)

	// Treaty is a collection of { ... } & { ... } & { ... }
	for (const route of extractRootObjects(
		flattened.replace(numberKey, '"$1":')
	)) {
		let processed = route.replaceAll(/readonly/g, '')

		// Replace import("...").TypeName with just TypeName
		// (the type should already be in typeAliases from resolveImportedTypes)
		// If the type has generic parameters, strip them and use the base name
		// (generics from external packages usually can't be resolved)
		processed = processed.replace(
			/import\([^)]*\)\.(\w+)(?:<[^>]*>)?/g,
			'$1'
		)

		// Inline any type aliases so TypeBox resolves them.
		// Loop because inlined bodies may contain further type references
		// (e.g. WorkflowSchema contains WorkflowOwner which also needs inlining).
		if (typeAliases) {
			const MAX_INLINE_PASSES = 10
			for (let pass = 0; pass < MAX_INLINE_PASSES; pass++) {
				const before = processed
				processed = inlineTypeReferences(processed, typeAliases)
				if (processed === before) break
			}
		}

		// Resolve `(typeof X)[number]` patterns using extracted const arrays
		if (constArrays) {
			processed = resolveTypeofIndexed(processed, constArrays)
		}

		// Replace `Date` type with `string` so TypeBox doesn't produce
		// the invalid `"type": "Date"` in JSON Schema. Dates serialize
		// as ISO 8601 strings in JSON responses.
		processed = processed.replace(/\bDate\b/g, 'string')

		let schema = TypeBox(processed)
		if (schema.type !== 'object') continue

		// Replace bare `$ref` entries (unresolved type names) with `{}`
		// TypeBox outputs `{"$ref": "TypeName"}` for types it can't resolve,
		// but these are not valid JSON Schema refs. Replace with empty schema.
		replaceBareRefs(schema)

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
	"outDir": "${distDir}"
}`
	},
	"include": ["${src}"]
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

				spawnSync(`tsc`, {
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
			const localAliases = extractTypeAliases(declaration)

			// Resolve cross-module import("...").TypeName references
			// and collect `const X = [...] as const` declarations
			const { aliases: typeAliases, constArrays } = resolveImportedTypes(
				declaration,
				projectRoot,
				tsconfigPath,
				src,
				localAliases,
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

			return declarationToJSONSchema(routeSection, typeAliases, constArrays)
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
