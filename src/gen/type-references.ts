import type ts from 'typescript'
import { getTypeScript } from './typescript'

type Filesystem = {
	existsSync: (path: string) => boolean
	readFileSync: (path: string, encoding: BufferEncoding) => string
}

const own = (object: Record<string, string>, key: string) =>
	Object.prototype.hasOwnProperty.call(object, key)

const parse = (code: string, fileName = 'openapi.ts') => {
	const ts = getTypeScript()
	return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true)
}

function stripComments(code: string) {
	const ts = getTypeScript()
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, false)
	scanner.setText(code)
	const ranges: [number, number, string][] = []
	let token: ts.SyntaxKind
	while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken)
		if (
			token === ts.SyntaxKind.SingleLineCommentTrivia ||
			token === ts.SyntaxKind.MultiLineCommentTrivia
		)
			ranges.push([scanner.getTokenPos(), scanner.getTextPos(), ' '])
	return replaceRanges(code, ranges).replace(/^\s*[|&]\s*/, '')
}

function replaceRanges(code: string, ranges: [number, number, string][]) {
	const parts: string[] = []
	let previousEnd = 0
	for (const [start, end, replacement] of ranges) {
		parts.push(code.slice(previousEnd, start), replacement)
		previousEnd = end
	}
	parts.push(code.slice(previousEnd))
	return parts.join('')
}

function createProgram(
	declaration: string,
	fileName: string,
	options: ts.CompilerOptions = {},
	fs?: Filesystem
) {
	const ts = getTypeScript()
	const compilerOptions = {
		...options,
		types: [],
		noEmit: true,
		skipLibCheck: true
	}
	const source = parse(declaration, fileName)
	const host: ts.CompilerHost = fs
		? ts.createCompilerHost(compilerOptions)
		: {
				getSourceFile: (name) =>
					name === fileName ? source : undefined,
				getDefaultLibFileName: () => '',
				writeFile: () => {},
				getCurrentDirectory: () => '',
				getDirectories: () => [],
				fileExists: (name) => name === fileName,
				readFile: (name) =>
					name === fileName ? declaration : undefined,
				getCanonicalFileName: (name) => name,
				useCaseSensitiveFileNames: () => true,
				getNewLine: () => '\n'
			}
	const originalGetSourceFile = host.getSourceFile.bind(host)
	host.getSourceFile = (name, ...args) =>
		name.replace(/\\/g, '/') === fileName
			? source
			: originalGetSourceFile(name, ...args)
	if (fs) {
		host.fileExists = fs.existsSync
		host.readFile = (name) => {
			try {
				return fs.readFileSync(name, 'utf8')
			} catch {
				return undefined
			}
		}
	}
	const program = ts.createProgram([fileName], compilerOptions, host)
	return { source, checker: program.getTypeChecker(), program }
}

const literal = (value: string | number) => JSON.stringify(value)

function enumBody(node: ts.EnumDeclaration, checker: ts.TypeChecker) {
	const values: string[] = []
	for (const member of node.members) {
		const value = checker.getConstantValue(member)
		if (value === undefined) return
		values.push(literal(value))
	}
	return values.length ? [...new Set(values)].join(' | ') : 'never'
}

function tupleBody(node: ts.VariableDeclaration) {
	const ts = getTypeScript()
	if (
		node.type &&
		ts.isTypeOperatorNode(node.type) &&
		node.type.operator === ts.SyntaxKind.ReadonlyKeyword &&
		ts.isTupleTypeNode(node.type.type)
	) {
		const elements = node.type.type.elements
		if (elements.every(ts.isLiteralTypeNode))
			return (
				elements.map((element) => element.getText()).join(' | ') ||
				'never'
			)
	}
	const initializer = node.initializer
	if (
		!initializer ||
		!ts.isAsExpression(initializer) ||
		!ts.isTypeReferenceNode(initializer.type) ||
		initializer.type.typeName.getText() !== 'const' ||
		!ts.isArrayLiteralExpression(initializer.expression)
	)
		return
	const values: string[] = []
	for (const element of initializer.expression.elements) {
		if (
			ts.isStringLiteral(element) ||
			ts.isNumericLiteral(element) ||
			element.kind === ts.SyntaxKind.TrueKeyword ||
			element.kind === ts.SyntaxKind.FalseKeyword ||
			(ts.isPrefixUnaryExpression(element) &&
				element.operator === ts.SyntaxKind.MinusToken &&
				ts.isNumericLiteral(element.operand))
		)
			values.push(element.getText())
		else return
	}
	return values.join(' | ') || 'never'
}

function queryTarget(node: ts.Node) {
	const ts = getTypeScript()
	if (
		!ts.isIndexedAccessTypeNode(node) ||
		node.indexType.kind !== ts.SyntaxKind.NumberKeyword
	)
		return
	let object = node.objectType
	while (ts.isParenthesizedTypeNode(object)) object = object.type
	if (ts.isTypeQueryNode(object))
		return {
			location: object.exprName,
			key: `typeof ${object.exprName.getText()}[number]`
		}
	if (
		ts.isImportTypeNode(object) &&
		object.isTypeOf &&
		object.qualifier &&
		ts.isLiteralTypeNode(object.argument) &&
		ts.isStringLiteral(object.argument.literal)
	)
		return {
			location: object.qualifier,
			key: `typeof import(${JSON.stringify(object.argument.literal.text)}).${object.qualifier.getText()}[number]`
		}
}

function referenceName(node: ts.Node): string | undefined {
	const ts = getTypeScript()
	if (ts.isTypeReferenceNode(node) && !node.typeArguments?.length)
		return node.typeName.getText()
	if (
		ts.isImportTypeNode(node) &&
		!node.isTypeOf &&
		!node.typeArguments?.length &&
		node.qualifier &&
		ts.isLiteralTypeNode(node.argument) &&
		ts.isStringLiteral(node.argument.literal)
	)
		return `import(${JSON.stringify(node.argument.literal.text)}).${node.qualifier.getText()}`
	return queryTarget(node)?.key
}

function isComputedType(node: ts.Node): node is ts.TypeNode {
	const ts = getTypeScript()
	return (
		((ts.isTypeReferenceNode(node) || ts.isImportTypeNode(node)) &&
			!!node.typeArguments?.length) ||
		ts.isTypeQueryNode(node) ||
		(ts.isTypeOperatorNode(node) &&
			node.operator === ts.SyntaxKind.KeyOfKeyword) ||
		ts.isIndexedAccessTypeNode(node) ||
		ts.isConditionalTypeNode(node) ||
		ts.isMappedTypeNode(node)
	)
}

/** Extract complete alias bodies, enum values, and readonly tuple element types. */
export function extractTypeAliases(
	declaration: string
): Record<string, string> {
	const ts = getTypeScript()
	let source = parse(declaration)
	const aliases: Record<string, string> = Object.create(null)
	let checker: ts.TypeChecker | undefined
	if (source.statements.some(ts.isEnumDeclaration))
		({ source, checker } = createProgram(declaration, source.fileName, {
			noLib: true,
			noResolve: true
		}))
	for (const node of source.statements) {
		if (ts.isTypeAliasDeclaration(node) && !node.typeParameters?.length)
			aliases[node.name.text] = stripComments(node.type.getText(source))
		else if (ts.isEnumDeclaration(node)) {
			const body = enumBody(node, checker!)
			if (body !== undefined) aliases[node.name.text] = body
		} else if (ts.isVariableStatement(node)) {
			for (const variable of node.declarationList.declarations) {
				if (!ts.isIdentifier(variable.name)) continue
				const body = tupleBody(variable)
				if (body !== undefined)
					aliases[`typeof ${variable.name.text}[number]`] = body
			}
		}
	}
	return aliases
}

/** Inline type nodes only, retaining property names, literals, and operator precedence. */
export function inlineTypeReferences(
	code: string,
	aliases: Record<string, string>,
	onUnresolved?: (name: string) => void
): string {
	const ts = getTypeScript()
	const cache = new Map<string, string>()
	const active = new Set<string>()
	let expandedSize = 0
	const expand = (body: string): string => {
		let prefix = 'type __OpenAPI = '
		let source = parse(prefix + body)
		if (source.statements.length !== 1) {
			prefix += '{'
			source = parse(prefix + body + '}')
		}
		const ranges: [number, number, string][] = []
		const replace = (node: ts.Node, replacement: string) =>
			ranges.push([
				node.getStart(source) - prefix.length,
				node.end - prefix.length,
				replacement
			])
		const visit = (node: ts.Node, bound = new Set<string>()) => {
			if (ts.isFunctionLike(node) && node.typeParameters?.length)
				bound = new Set([
					...bound,
					...node.typeParameters.map(
						(parameter) => parameter.name.text
					)
				])
			let name = referenceName(node)
			if (
				!name &&
				isComputedType(node) &&
				own(aliases, node.getText(source))
			)
				name = node.getText(source)
			if (name && ts.isTypeReferenceNode(node) && bound.has(name)) return
			if (
				name &&
				!own(aliases, name) &&
				ts.isImportTypeNode(node) &&
				node.qualifier
			)
				name = node.qualifier.getText()
			if (name && own(aliases, name)) {
				if (active.has(name) || active.size >= 100) {
					onUnresolved?.(name)
					replace(node, 'unknown')
					return
				}
				let replacement = cache.get(name)
				if (replacement === undefined) {
					active.add(name)
					replacement = expand(aliases[name])
					active.delete(name)
					const alias = parse('type __OpenAPI = ' + replacement)
						.statements[0]
					if (
						ts.isTypeAliasDeclaration(alias) &&
						(ts.isUnionTypeNode(alias.type) ||
							ts.isIntersectionTypeNode(alias.type) ||
							ts.isFunctionTypeNode(alias.type) ||
							ts.isConditionalTypeNode(alias.type))
					)
						replacement = `(${replacement})`
					cache.set(name, replacement)
				}
				expandedSize += replacement.length
				if (expandedSize > 1_000_000) {
					onUnresolved?.(name)
					replacement = 'unknown'
				}
				replace(node, replacement)
				return
			}
			if (ts.isImportTypeNode(node) || queryTarget(node)) {
				onUnresolved?.(node.getText(source))
				replace(node, 'unknown')
				return
			}
			ts.forEachChild(node, (child) => visit(child, bound))
		}
		visit(source)
		return replaceRanges(body, ranges)
	}
	return expand(code)
}

/** Resolve imported symbols once and keep their dependencies scoped to their module. */
export function resolveImportedTypes(
	declaration: string,
	projectRoot: string,
	tsconfigPath: string,
	sourceFilePath: string,
	existingAliases: Record<string, string>,
	fs: Filesystem,
	resolvedCompilerOptions?: ts.CompilerOptions
): Record<string, string> {
	const ts = getTypeScript()
	const { resolve } = process.getBuiltinModule('path')
	const aliases: Record<string, string> = Object.assign(
		Object.create(null),
		existingAliases
	)
	const configPath = resolve(projectRoot, tsconfigPath)
	let options: ts.CompilerOptions = {
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler
	}
	if (fs.existsSync(configPath)) {
		const config = ts.getParsedCommandLineOfConfigFile(
			configPath,
			undefined,
			{
				...ts.sys,
				fileExists: fs.existsSync,
				readFile: (name) =>
					fs.existsSync(name)
						? fs.readFileSync(name, 'utf8')
						: undefined,
				onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
					throw new Error(
						ts.flattenDiagnosticMessageText(
							diagnostic.messageText,
							'\n'
						)
					)
				}
			}
		)
		if (config) options = config.options
	}
	options = { ...options, ...resolvedCompilerOptions }
	const fileName = resolve(projectRoot, sourceFilePath).replace(/\\/g, '/')
	const { source, checker, program } = createProgram(
		declaration,
		fileName,
		options,
		fs
	)
	const names = new Map<ts.Symbol, string>()
	let nextName = 0
	const allocateName = (hint = '') => {
		let name: string
		do
			name = `__OpenAPIType${nextName++}${hint ? '_' + hint.replace(/[^\w$]/g, '_') : ''}`
		while (own(aliases, name))
		return name
	}
	const register = (symbol: ts.Symbol | undefined): string | undefined => {
		if (!symbol) return
		if (symbol.flags & ts.SymbolFlags.Alias)
			symbol = checker.getAliasedSymbol(symbol)
		if (symbol.flags & ts.SymbolFlags.TypeParameter) return
		if (
			symbol.declarations?.every((node) =>
				program.isSourceFileDefaultLibrary(node.getSourceFile())
			)
		)
			return
		const known = names.get(symbol)
		if (known) return known
		const unresolved = () => {
			const name = allocateName(symbol.getName())
			names.set(symbol, name)
			return name
		}
		const node = symbol.declarations?.find(
			(node) =>
				(ts.isTypeAliasDeclaration(node) &&
					!node.typeParameters?.length) ||
				ts.isEnumDeclaration(node) ||
				ts.isEnumMember(node) ||
				ts.isVariableDeclaration(node)
		)
		if (!node) {
			if (!symbol.declarations?.length) return
			return unresolved()
		}
		let body: string | undefined
		if (ts.isEnumDeclaration(node)) body = enumBody(node, checker)
		else if (ts.isEnumMember(node)) {
			const value = checker.getConstantValue(node)
			if (value !== undefined) body = literal(value)
		} else if (ts.isVariableDeclaration(node)) body = tupleBody(node)
		else if (!ts.isTypeAliasDeclaration(node)) return
		if (body === undefined && !ts.isTypeAliasDeclaration(node))
			return unresolved()
		let name: string
		if (node.getSourceFile() === source && ts.isTypeAliasDeclaration(node))
			name = node.name.text
		else name = allocateName()
		names.set(symbol, name)
		aliases[name] = body ?? rewrite((node as ts.TypeAliasDeclaration).type)
		return name
	}
	const resolveExpression = (node: ts.TypeNode): string | undefined => {
		if (
			ts.isTypeReferenceNode(node) &&
			ts.isIdentifier(node.typeName) &&
			['Array', 'ReadonlyArray', 'Record'].includes(node.typeName.text)
		) {
			const symbol = checker.getSymbolAtLocation(node.typeName)
			if (
				symbol?.declarations?.every((declaration) =>
					program.isSourceFileDefaultLibrary(
						declaration.getSourceFile()
					)
				)
			)
				return
		}
		const type = checker.getTypeFromTypeNode(node)
		if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return
		const resolved = checker.typeToTypeNode(
			type,
			node,
			ts.NodeBuilderFlags.NoTruncation | ts.NodeBuilderFlags.InTypeAlias
		)
		if (!resolved) return
		const transformed = ts.transform(resolved, [
			(context) => {
				const visit: ts.Visitor = (child) => {
					const location =
						ts.isTypeReferenceNode(child) &&
						!child.typeArguments?.length
							? child.typeName
							: ts.isImportTypeNode(child) &&
								  !child.typeArguments?.length
								? child.qualifier
								: undefined
					if (location) {
						const symbol =
							checker.getSymbolAtLocation(location) ??
							(ts.isIdentifier(location)
								? checker.resolveName(
										location.text,
										node,
										ts.SymbolFlags.Type,
										false
									)
								: undefined)
						const name = register(symbol)
						if (name)
							return context.factory.createTypeReferenceNode(name)
					}
					return ts.visitEachChild(child, visit, context)
				}
				return (root) => ts.visitNode(root, visit) as ts.TypeNode
			}
		])
		try {
			const text = ts
				.createPrinter({ removeComments: true })
				.printNode(
					ts.EmitHint.Unspecified,
					transformed.transformed[0],
					node.getSourceFile()
				)
			return text === node.getText() ? undefined : text
		} finally {
			transformed.dispose()
		}
	}
	const rewrite = (root: ts.Node): string => {
		const rootSource = root.getSourceFile()
		const start = root.getStart(rootSource)
		const ranges: [number, number, string][] = []
		const visit = (node: ts.Node) => {
			if (
				isComputedType(node) &&
				!(
					rootSource === source &&
					ts.isVariableDeclaration(node.parent)
				)
			) {
				const body = resolveExpression(node)
				if (body !== undefined) {
					const name = allocateName()
					aliases[name] = body
					ranges.push([
						node.getStart(rootSource) - start,
						node.end - start,
						name
					])
					if (rootSource === source)
						aliases[
							referenceName(node) ?? node.getText(rootSource)
						] = name
					return
				}
			}
			const key = referenceName(node)
			if (key) {
				const location = ts.isTypeReferenceNode(node)
					? node.typeName
					: ts.isImportTypeNode(node)
						? node.qualifier!
						: queryTarget(node)!.location
				const symbol = checker.getSymbolAtLocation(location)
				let name = register(symbol)
				if (
					!name &&
					(ts.isImportTypeNode(node) ||
						(rootSource !== source &&
							own(aliases, key) &&
							!(
								symbol?.flags &&
								symbol.flags & ts.SymbolFlags.TypeParameter
							)))
				)
					name = allocateName()
				if (name) {
					ranges.push([
						node.getStart(rootSource) - start,
						node.end - start,
						name
					])
					if (rootSource === source && key !== name)
						aliases[key] = name
					return
				}
			}
			ts.forEachChild(node, visit)
		}
		visit(root)
		return stripComments(replaceRanges(root.getText(rootSource), ranges))
	}
	for (const node of source.statements) {
		if (ts.isTypeAliasDeclaration(node) && !node.typeParameters?.length)
			register(checker.getSymbolAtLocation(node.name))
		else rewrite(node)
	}
	return aliases
}
