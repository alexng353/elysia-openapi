import type ts from 'typescript'
import { getTypeScript } from './typescript'

type RouteDeclaration = { path: string[]; method: string; type: string }

const methods = new Set([
	'get',
	'post',
	'put',
	'patch',
	'delete',
	'head',
	'options',
	'trace',
	'connect',
	'all',
	'subscribe'
])

function propertyName(name: ts.PropertyName): string | undefined {
	const ts = getTypeScript()
	if (
		ts.isIdentifier(name) ||
		ts.isStringLiteral(name) ||
		ts.isNumericLiteral(name)
	)
		return name.text
	if (
		ts.isComputedPropertyName(name) &&
		(ts.isStringLiteral(name.expression) ||
			ts.isNumericLiteral(name.expression))
	)
		return name.expression.text
}

function hasCompleteMetadata(type: ts.TypeNode): boolean {
	const ts = getTypeScript()
	const fields = new Set<string>()
	const collect = (node: ts.TypeNode) => {
		if (ts.isParenthesizedTypeNode(node)) collect(node.type)
		else if (ts.isIntersectionTypeNode(node)) node.types.forEach(collect)
		else if (ts.isTypeLiteralNode(node))
			for (const member of node.members)
				if (ts.isPropertySignature(member))
					fields.add(propertyName(member.name) ?? '')
	}
	collect(type)
	return ['body', 'params', 'query', 'headers', 'response'].every((field) =>
		fields.has(field)
	)
}

function containsCompleteRoute(node: ts.Node): boolean {
	const ts = getTypeScript()
	if (
		ts.isPropertySignature(node) &&
		node.type &&
		methods.has(propertyName(node.name)?.toLowerCase() ?? '') &&
		hasCompleteMetadata(node.type)
	)
		return true
	return (
		ts.forEachChild(
			node,
			(child) => containsCompleteRoute(child) || undefined
		) ?? false
	)
}

function hasResponse(type: ts.TypeNode): boolean {
	const ts = getTypeScript()
	if (hasCompleteMetadata(type)) return true
	if (ts.isParenthesizedTypeNode(type)) return hasResponse(type.type)
	if (ts.isIntersectionTypeNode(type)) return type.types.some(hasResponse)
	return (
		ts.isTypeLiteralNode(type) &&
		type.members.some(
			(member) =>
				ts.isPropertySignature(member) &&
				propertyName(member.name) === 'response' &&
				member.type &&
				!containsCompleteRoute(member.type) &&
				(!ts.isTypeLiteralNode(member.type) ||
					member.type.members.every(
						(status) =>
							ts.isIndexSignatureDeclaration(status) ||
							(ts.isPropertySignature(status) &&
								/^(?:\d+|default)$/.test(
									propertyName(status.name) ?? ''
								))
					))
		)
	)
}

export function extractRouteDeclarations(
	declaration: string
): RouteDeclaration[] {
	const ts = getTypeScript()
	const source = ts.createSourceFile(
		'routes.d.ts',
		`type Routes = ${declaration}`,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	)
	const statement = source.statements[0]
	if (!statement || !ts.isTypeAliasDeclaration(statement)) return []
	const routes: RouteDeclaration[] = []

	const visit = (node: ts.TypeNode, path: string[]) => {
		if (ts.isParenthesizedTypeNode(node)) return visit(node.type, path)
		if (ts.isIntersectionTypeNode(node)) {
			for (const member of node.types) visit(member, path)
			return
		}
		if (!ts.isTypeLiteralNode(node)) return
		for (const member of node.members) {
			if (!ts.isPropertySignature(member) || !member.type) continue
			const name = propertyName(member.name)
			if (name === undefined) continue
			if (methods.has(name.toLowerCase()) && hasResponse(member.type)) {
				routes.push({
					path,
					method: name.toLowerCase(),
					type: member.type.getText(source)
				})
			} else {
				visit(member.type, [...path, name])
			}
		}
	}
	visit(statement.type, [])
	return routes
}

/** Split the route tree while keeping each method's request and response types intact. */
export function flattenNestedIntersections(declaration: string): string {
	return extractRouteDeclarations(declaration)
		.map(({ path, method, type }) => {
			let result = `{ ${JSON.stringify(method)}: ${type} }`
			for (let index = path.length - 1; index >= 0; index--)
				result = `{ ${JSON.stringify(path[index])}: ${result} }`
			return result
		})
		.join(' & ')
}

export function normalizeGeneratedSchema(
	schema: Record<string | symbol, any>,
	onUnresolved: (name: string) => void
): void {
	if (
		schema.patternProperties &&
		Object.keys(schema.patternProperties).length === 1 &&
		'^(.*)$' in schema.patternProperties
	) {
		schema.additionalProperties = schema.patternProperties['^(.*)$']
		delete schema.patternProperties
		schema.properties ??= {}
		schema[Symbol.for('TypeBox.Kind')] = 'Object'
	}
	if (typeof schema.$ref === 'string' && !schema.$ref.startsWith('#/')) {
		onUnresolved(schema.$ref)
		delete schema.$ref
		schema[Symbol.for('TypeBox.Kind')] = 'Unknown'
	}
	if (schema.type === 'Date') {
		schema.type = 'string'
		schema.format = 'date-time'
		// TypeBox consumers use Kind in addition to the JSON Schema type.
		schema[Symbol.for('TypeBox.Kind')] = 'String'
	}
	if (
		typeof schema.type === 'string' &&
		![
			'string',
			'number',
			'integer',
			'boolean',
			'object',
			'array',
			'null'
		].includes(schema.type)
	) {
		onUnresolved(schema.type)
		for (const key of Reflect.ownKeys(schema)) delete schema[key]
		schema[Symbol.for('TypeBox.Kind')] = 'Unknown'
		return
	}
	for (const value of Object.values(schema)) {
		if (value && typeof value === 'object')
			normalizeGeneratedSchema(value, onUnresolved)
	}
}

const genericTypes = new Set([
	'Array',
	'Record',
	'Partial',
	'Required',
	'Pick',
	'Omit',
	'Exclude',
	'Extract',
	'Awaited',
	'Promise',
	'Uppercase',
	'Lowercase',
	'Capitalize',
	'Uncapitalize'
])

export function prepareTypeForParser(
	type: string,
	onUnresolved?: (name: string) => void
): string {
	const ts = getTypeScript()
	const source = ts.createSourceFile(
		'schema.ts',
		`type Schema = ${type}`,
		ts.ScriptTarget.Latest,
		true
	)
	const transformed = ts.transform(source, [
		(context) => {
			const unknown = (node: ts.Node) => {
				onUnresolved?.(node.getText(source))
				return context.factory.createKeywordTypeNode(
					ts.SyntaxKind.UnknownKeyword
				)
			}
			const unionMembers = (node: ts.TypeNode): ts.TypeNode[] => {
				if (ts.isParenthesizedTypeNode(node))
					return unionMembers(node.type)
				if (ts.isUnionTypeNode(node))
					return node.types.flatMap(unionMembers)
				return [node]
			}
			const unsupportedKey = (node: ts.Node): boolean =>
				node.kind === ts.SyntaxKind.NumberKeyword ||
				ts.isTemplateLiteralTypeNode(node) ||
				(ts.forEachChild(
					node,
					(child) => unsupportedKey(child) || undefined
				) ??
					false)
			const visit: ts.Visitor = (node) => {
				if (
					ts.isTypeReferenceNode(node) &&
					ts.isIdentifier(node.typeName)
				) {
					const name = node.typeName.text
					if (
						name === 'ReadonlyArray' &&
						node.typeArguments?.length === 1
					)
						return context.factory.createArrayTypeNode(
							ts.visitNode(
								node.typeArguments[0],
								visit
							) as ts.TypeNode
						)
					if (name === 'Readonly' && node.typeArguments?.length === 1)
						return ts.visitNode(node.typeArguments[0], visit)
					if (
						name === 'Record' &&
						node.typeArguments?.[0] &&
						unsupportedKey(node.typeArguments[0])
					)
						return unknown(node)
				}
				if (
					ts.isFunctionTypeNode(node) ||
					ts.isTemplateLiteralTypeNode(node) ||
					(ts.isTupleTypeNode(node) &&
						node.elements.some(
							(element) =>
								ts.isNamedTupleMember(element) ||
								ts.isRestTypeNode(element) ||
								ts.isOptionalTypeNode(element)
						))
				)
					return unknown(node)
				if (ts.isIntersectionTypeNode(node)) {
					const types = node.types
						.map((type) => ts.visitNode(type, visit) as ts.TypeNode)
						.filter(
							(type) => type.kind !== ts.SyntaxKind.UnknownKeyword
						)
					if (types.length === 1) return types[0]
					if (types.length)
						return context.factory.createIntersectionTypeNode(types)
					return context.factory.createKeywordTypeNode(
						ts.SyntaxKind.UnknownKeyword
					)
				}
				if (ts.isTypeLiteralNode(node)) {
					const members: ts.TypeElement[] = []
					const records: ts.TypeNode[] = []
					for (const member of node.members) {
						if (ts.isIndexSignatureDeclaration(member)) {
							const key = member.parameters[0]?.type
							if (key?.kind === ts.SyntaxKind.SymbolKeyword)
								continue
							if (
								key &&
								key.kind !== ts.SyntaxKind.StringKeyword
							) {
								onUnresolved?.(member.getText(source))
								continue
							}
							records.push(
								context.factory.createTypeReferenceNode(
									'Record',
									[
										key
											? (ts.visitNode(
													key,
													visit
												) as ts.TypeNode)
											: context.factory.createKeywordTypeNode(
													ts.SyntaxKind.StringKeyword
												),
										ts.visitNode(
											member.type,
											visit
										) as ts.TypeNode
									]
								)
							)
						} else if (
							ts.isPropertySignature(member) &&
							propertyName(member.name) !== undefined
						) {
							members.push(
								ts.visitNode(member, visit) as ts.TypeElement
							)
						}
					}
					// Symbol keys and methods do not appear in serialized JSON values.
					if (
						node.members.length &&
						!members.length &&
						!records.length
					)
						return context.factory.createKeywordTypeNode(
							ts.SyntaxKind.UnknownKeyword
						)
					if (!records.length)
						return context.factory.createTypeLiteralNode(members)
					if (members.length)
						records.unshift(
							context.factory.createTypeLiteralNode(members)
						)
					return records.length === 1
						? records[0]
						: context.factory.createIntersectionTypeNode(records)
				}
				if (
					ts.isTypeQueryNode(node) ||
					ts.isMappedTypeNode(node) ||
					ts.isConditionalTypeNode(node) ||
					ts.isIndexedAccessTypeNode(node) ||
					(ts.isTypeReferenceNode(node) &&
						((node.typeArguments?.length &&
							!genericTypes.has(node.typeName.getText(source))) ||
							ts.isQualifiedName(node.typeName)))
				) {
					onUnresolved?.(node.getText(source))
					return context.factory.createKeywordTypeNode(
						ts.SyntaxKind.UnknownKeyword
					)
				}
				if (
					ts.isTypeOperatorNode(node) &&
					node.operator === ts.SyntaxKind.ReadonlyKeyword
				)
					return ts.visitNode(node.type, visit)
				if (ts.isPropertySignature(node)) {
					const name = propertyName(node.name)
					let type = node.type
					const members = type ? unionMembers(type) : []
					const types = members.filter(
						(type) => type.kind !== ts.SyntaxKind.UndefinedKeyword
					)
					const optional =
						members.length > 1 && types.length !== members.length
					if (optional && type) {
						// Undefined object values are omitted when serialized as JSON.
						if (types.length === 1) type = types[0]
						else if (types.length)
							type = context.factory.createUnionTypeNode(types)
						else type = unknown(type)
					}
					return context.factory.updatePropertySignature(
						node,
						node.modifiers?.filter(
							(modifier) =>
								modifier.kind !== ts.SyntaxKind.ReadonlyKeyword
						),
						name === undefined
							? node.name
							: context.factory.createStringLiteral(name),
						node.questionToken ??
							(optional
								? context.factory.createToken(
										ts.SyntaxKind.QuestionToken
									)
								: undefined),
						type
							? (ts.visitNode(type, visit) as ts.TypeNode)
							: undefined
					)
				}
				return ts.visitEachChild(node, visit, context)
			}
			return (root) => ts.visitNode(root, visit) as ts.SourceFile
		}
	])
	try {
		const result = transformed.transformed[0]
			.statements[0] as ts.TypeAliasDeclaration
		return ts
			.createPrinter({ removeComments: true })
			.printNode(ts.EmitHint.Unspecified, result.type, source)
	} finally {
		transformed.dispose()
	}
}
