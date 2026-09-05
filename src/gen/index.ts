import { TypeBox } from '@sinclair/typemap'
import { Type, type TSchema } from '@sinclair/typebox'
import type ts from 'typescript'
import { getTypeScript } from './typescript'
import type { AdditionalReference } from '../types'
import {
	extractTypeAliases,
	inlineTypeReferences,
	resolveImportedTypes
} from './type-references'
export {
	extractTypeAliases,
	inlineTypeReferences,
	resolveImportedTypes
} from './type-references'
import {
	extractRouteDeclarations,
	normalizeGeneratedSchema,
	prepareTypeForParser
} from './route-declarations'
export { flattenNestedIntersections } from './route-declarations'

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

function metadataProperties(
	schema: TSchema
): Record<string, TSchema> | undefined {
	if (schema.properties) return { ...schema.properties }
	if (!Array.isArray(schema.allOf)) return
	const properties: Record<string, TSchema> = Object.create(null)
	for (const member of schema.allOf) {
		const fields = metadataProperties(member)
		if (!fields) return
		for (const [key, value] of Object.entries(fields))
			properties[key] = properties[key]
				? Type.Intersect([properties[key], value])
				: value
	}
	return properties
}

export function declarationToJSONSchema(
	declaration: string,
	typeAliases?: Record<string, string>,
	{ silent = false }: Pick<OpenAPIGeneratorOptions, 'silent'> = {}
) {
	const routes: AdditionalReference = {}
	const unresolved = new Set<string>()
	const onUnresolved = (name: string) => {
		unresolved.add(name)
	}

	for (const route of extractRouteDeclarations(declaration)) {
		let processed = route.type
		processed = inlineTypeReferences(
			processed,
			typeAliases ?? {},
			onUnresolved
		)

		const schema = TypeBox(prepareTypeForParser(processed, onUnresolved))
		const properties = metadataProperties(schema)
		if (!properties) {
			onUnresolved(
				`${route.method.toUpperCase()} /${route.path.join('/')}: unsupported route declaration`
			)
			continue
		}
		for (const [name, value] of Object.entries(properties)) {
			const response = name === 'response' && metadataProperties(value)
			if (response) {
				for (const schema of Object.values(response)) {
					// Empty response markers are consumed before OpenAPI content is emitted.
					if (schema.type !== 'void' && schema.type !== 'undefined')
						normalizeGeneratedSchema(schema, onUnresolved)
				}
				properties.response = response as unknown as TSchema
			} else normalizeGeneratedSchema(value, onUnresolved)
		}

		const path = '/' + route.path.join('/')
		if (!routes[path]) routes[path] = {}
		// @ts-ignore
		routes[path][route.method] = properties
	}

	if (unresolved.size && !silent) {
		const examples = [...unresolved].slice(0, 10).map((name) => {
			const compact = name.replace(/\s+/g, ' ')
			return compact.length > 120
				? compact.slice(0, 117) + '...'
				: compact
		})
		const remaining =
			unresolved.size > examples.length
				? `; ${unresolved.size - examples.length} more`
				: ''
		console.warn(
			`[@elysiajs/openapi/gen] Unsupported types or declarations (${unresolved.size}): ${examples.join(', ')}${remaining}. Unresolved fields use unknown schemas.`
		)
	}
	return routes
}

/** Extract a generic argument without treating literal text or arrow tokens as delimiters. */
export function extractGenericParam(
	instance: string,
	paramIndex: number
): string | undefined {
	const ts = getTypeScript()
	const source = ts.createSourceFile(
		'instance.d.ts',
		`type Instance = ${instance.replace(/^\s*:\s*/, '')}`,
		ts.ScriptTarget.Latest,
		true
	)
	const statement = source.statements[0]
	if (!statement || !ts.isTypeAliasDeclaration(statement)) return
	const type = statement.type
	if (ts.isTypeReferenceNode(type) || ts.isImportTypeNode(type))
		return type.typeArguments?.[paramIndex]?.getText(source)
}

function findRouteSection(
	declaration: string,
	instanceName?: string
): string | undefined {
	const ts = getTypeScript()
	const source = ts.createSourceFile(
		'app.d.ts',
		declaration,
		ts.ScriptTarget.Latest,
		true
	)
	const names = new Set(['Elysia'])
	for (const statement of source.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier) ||
			statement.moduleSpecifier.text !== 'elysia'
		)
			continue
		const clause = statement.importClause
		if (clause?.name) names.add(clause.name.text)
		if (
			clause?.namedBindings &&
			ts.isNamespaceImport(clause.namedBindings)
		) {
			names.add(`${clause.namedBindings.name.text}.Elysia`)
			names.add(`${clause.namedBindings.name.text}.default`)
		}
		if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
			for (const element of clause.namedBindings.elements)
				if (
					['Elysia', 'default'].includes(
						element.propertyName?.text ?? element.name.text
					)
				)
					names.add(element.name.text)
	}
	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement)) continue
		for (const variable of statement.declarationList.declarations) {
			if (
				!ts.isIdentifier(variable.name) ||
				(instanceName && variable.name.text !== instanceName)
			)
				continue
			const type = variable.type
			if (
				type &&
				ts.isTypeReferenceNode(type) &&
				names.has(type.typeName.getText(source))
			)
				return type.typeArguments?.[4]?.getText(source)
			if (
				type &&
				ts.isImportTypeNode(type) &&
				ts.isLiteralTypeNode(type.argument) &&
				ts.isStringLiteral(type.argument.literal) &&
				type.argument.literal.text === 'elysia' &&
				['Elysia', 'default'].includes(
					type.qualifier?.getText(source) ?? ''
				)
			)
				return type.typeArguments?.[4]?.getText(source)
		}
	}
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
			projectRoot = typeof process === 'undefined' ? '' : process.cwd(),
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
			return declarationToJSONSchema(targetFilePath, undefined, {
				silent
			})

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

			const path = process.getBuiltinModule('path')
			const src = path.resolve(projectRoot, targetFilePath)

			if (!fs.existsSync(src))
				throw new Error(
					`Couldn't find "${targetFilePath}" from ${projectRoot}`
				)

			let targetFile: string | undefined
			let resolvedOptions: ts.CompilerOptions | undefined

			if (!tmpRoot) {
				const os = process.getBuiltinModule('os')

				tmpRoot = join(
					os && typeof os.tmpdir === 'function'
						? os.tmpdir()
						: projectRoot,
					'.ElysiaAutoOpenAPI'
				)
			}
			tmpRoot = path.resolve(tmpRoot)

			// Since it's already a declaration file
			// We can just read it directly
			if (targetFilePath.endsWith('.d.ts')) targetFile = src
			else {
				if (fs.existsSync(tmpRoot))
					fs.rmSync(tmpRoot, { recursive: true, force: true })

				fs.mkdirSync(tmpRoot, { recursive: true })

				const tsconfig = path.resolve(projectRoot, tsconfigPath)
				const distDir = path.join(tmpRoot, 'dist')

				const resolvedCompilerOptions = {
					lib: ['ESNext'],
					module: 'ESNext',
					noEmit: false,
					declaration: true,
					emitDeclarationOnly: true,
					moduleResolution: 'bundler',
					skipLibCheck: true,
					skipDefaultLibCheck: true,
					outDir: distDir,
					...compilerOptions
				}

				const config = {
					...(fs.existsSync(tsconfig) ? { extends: tsconfig } : {}),
					compilerOptions: resolvedCompilerOptions,
					include: [src],
					exclude: []
				}
				const configPath = path.join(tmpRoot, 'tsconfig.json')
				fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

				const ts = getTypeScript()
				const parsed = ts.getParsedCommandLineOfConfigFile(
					configPath,
					undefined,
					{
						...ts.sys,
						onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
							throw new Error(
								ts.flattenDiagnosticMessageText(
									diagnostic.messageText,
									'\n'
								)
							)
						}
					}
				)!
				const host = ts.createCompilerHost(parsed.options)
				resolvedOptions = parsed.options
				const outputDirectories = [
					parsed.options.outDir ?? distDir,
					...(parsed.options.declarationDir
						? [parsed.options.declarationDir]
						: [])
				]
				const program = ts.createProgram({
					rootNames: parsed.fileNames,
					options: parsed.options,
					host,
					projectReferences: parsed.projectReferences,
					configFileParsingDiagnostics: parsed.errors
				})
				const result = program.emit(
					undefined,
					(fileName, text, bom, onError, sourceFiles, data) => {
						// TypeScript can emit beside source files outside an explicit rootDir.
						if (
							!outputDirectories.some((directory) => {
								const relative = path.relative(
									directory,
									fileName
								)
								return (
									relative !== '..' &&
									!relative.startsWith(`..${path.sep}`) &&
									!path.isAbsolute(relative)
								)
							})
						) {
							onError?.(
								'Output is outside the configured output directories'
							)
							return
						}
						host.writeFile(
							fileName,
							text,
							bom,
							onError,
							sourceFiles,
							data
						)
						if (
							fileName.endsWith('.d.ts') &&
							sourceFiles?.some(
								(file) => path.resolve(file.fileName) === src
							)
						)
							targetFile = fileName
					}
				)

				if (typeof overrideOutputPath === 'function')
					targetFile = overrideOutputPath(tmpRoot) ?? targetFile
				else if (overrideOutputPath)
					targetFile = path.resolve(distDir, overrideOutputPath)

				if (!silent || !targetFile) {
					const diagnostics = ts.sortAndDeduplicateDiagnostics([
						...ts.getPreEmitDiagnostics(program),
						...result.diagnostics
					])
					if (diagnostics.length)
						console.warn(
							ts.formatDiagnostics(diagnostics, {
								getCanonicalFileName: (file) => file,
								getCurrentDirectory: () => projectRoot,
								getNewLine: () => '\n'
							})
						)
				}

				if (!targetFile || !fs.existsSync(targetFile))
					throw new Error("Couldn't find generated declaration file")
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
				fs,
				resolvedOptions ??
					(compilerOptions
						? getTypeScript().convertCompilerOptionsFromJson(
								compilerOptions,
								projectRoot
							).options
						: undefined)
			)

			const routeSection = findRouteSection(declaration, instanceName)
			if (!routeSection) {
				if (!silent)
					console.warn(
						`[@elysiajs/openapi/gen] Couldn't find ${instanceName ? `Elysia instance "${instanceName}"` : 'an Elysia instance'} with route declarations in "${src}".`
					)
				return
			}

			return declarationToJSONSchema(routeSection, typeAliases, {
				silent
			})
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
