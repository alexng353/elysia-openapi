import { describe, expect, it } from 'bun:test'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { TypeBox } from '@sinclair/typemap'
import {
	extractTypeAliases,
	inlineTypeReferences,
	resolveImportedTypes
} from '../../src/gen/type-references'

const schema = (code: string, aliases: Record<string, string>) =>
	JSON.parse(JSON.stringify(TypeBox(inlineTypeReferences(code, aliases))))

const fixture = join(import.meta.dir, 'fixtures', 'type-references')
const imported = (declaration: string) =>
	resolveImportedTypes(
		declaration,
		fixture,
		'config/tsconfig.json',
		join(fixture, 'entry.ts'),
		extractTypeAliases(declaration),
		fs
	)

describe('Gen > Type references', () => {
	it('extracts complete unions and object intersections without interpreting literals as comments', () => {
		const aliases = extractTypeAliases(`
			type Status =
				| "ready"
				| "https://example.com/*keep*/";
			type Result = { status: Status } & { count: number };
		`)

		expect(schema('Status[]', aliases)).toEqual({
			type: 'array',
			items: {
				anyOf: [
					{ const: 'ready', type: 'string' },
					{ const: 'https://example.com/*keep*/', type: 'string' }
				]
			}
		})
		expect(aliases.Result).toContain('count: number')
	})

	it('replaces type nodes without changing property names or string literals', () => {
		expect(
			schema('{ User: User; label: "User"; path: "https://User" }', {
				User: '{ id: string }'
			})
		).toEqual({
			type: 'object',
			properties: {
				User: {
					type: 'object',
					properties: { id: { type: 'string' } },
					required: ['id']
				},
				label: { const: 'User', type: 'string' },
				path: { const: 'https://User', type: 'string' }
			},
			required: ['User', 'label', 'path']
		})
	})

	it('resolves a dependency chain regardless of alias insertion order', () => {
		expect(
			schema('Short', { Leaf: 'string', Short: 'Longer', Longer: 'Leaf' })
		).toEqual({ type: 'string' })
	})

	it('preserves the precedence of an inlined union under an array', () => {
		expect(schema('Choice[]', { Choice: '"a" | "b"' })).toEqual({
			type: 'array',
			items: {
				anyOf: [
					{ const: 'a', type: 'string' },
					{ const: 'b', type: 'string' }
				]
			}
		})
	})

	it('preserves finite fields and reports the recursive edges of circular aliases', () => {
		const unresolved: string[] = []
		const result = JSON.parse(
			JSON.stringify(
				TypeBox(
					inlineTypeReferences(
						'Tree',
						{
							Tree: '{ id: string; left: Branch; right: Branch }',
							Branch: '{ left: Tree; right: Tree }'
						},
						(name) => unresolved.push(name)
					)
				)
			)
		)
		expect(result.properties.id).toEqual({ type: 'string' })
		expect(result.properties.left.properties.left).toEqual({})
		expect(unresolved).toContain('Tree')
	})

	it('bounds expansion when a small acyclic graph describes an enormous tree', () => {
		const aliases: Record<string, string> = { Level0: 'string' }
		for (let i = 1; i < 30; i++)
			aliases[`Level${i}`] =
				`{ left: Level${i - 1}; right: Level${i - 1} }`
		const unresolved: string[] = []
		const result = inlineTypeReferences('Level29', aliases, (name) =>
			unresolved.push(name)
		)
		expect(result.length).toBeLessThan(1_000_000)
		expect(unresolved.length).toBeGreaterThan(0)
	})

	it('keeps generic type parameter bindings separate from top-level aliases', () => {
		expect(
			inlineTypeReferences('<User>(input: User) => User', {
				User: 'string'
			})
		).toBe('<User>(input: User) => User')
	})

	it('extracts string and numeric enum values including auto increments', () => {
		const aliases = extractTypeAliases(`
			enum Status { Ready = "ready", Done = "done" }
			enum Code { Missing = -1, Ready, Flags = 1 << 2, Next }
		`)
		expect(schema('Status', aliases)).toEqual({
			anyOf: [
				{ const: 'ready', type: 'string' },
				{ const: 'done', type: 'string' }
			]
		})
		expect(schema('Code', aliases)).toEqual({
			anyOf: [-1, 0, 4, 5].map((value) => ({
				const: value,
				type: 'number'
			}))
		})
	})

	it('retains escaped enum literals as valid TypeScript strings', () => {
		expect(
			extractTypeAliases('enum Status { Escaped = "a\\\"b" }').Status
		).toBe('"a\\\"b"')
	})

	it('does not narrow partially computed enums to only the known members', () => {
		const aliases = extractTypeAliases(
			'enum Dynamic { A = "a", B = getValue() }'
		)
		expect(aliases.Dynamic).toBeUndefined()
	})

	it('resolves readonly source and declaration tuples to all literal element values', () => {
		const aliases = extractTypeAliases(`
			const source = ["", "a]b", 2, false] as const;
			declare const emitted: readonly ["ready", "done"];
			type Source = (typeof source)[number];
			type Emitted = typeof emitted[number];
		`)
		expect(schema('Source', aliases)).toEqual({
			anyOf: [
				{ const: '', type: 'string' },
				{ const: 'a]b', type: 'string' },
				{ const: 2, type: 'number' },
				{ const: false, type: 'boolean' }
			]
		})
		expect(schema('Emitted', aliases)).toEqual({
			anyOf: [
				{ const: 'ready', type: 'string' },
				{ const: 'done', type: 'string' }
			]
		})
	})

	it('keeps same-named imported types and private dependencies scoped to their module', () => {
		const code =
			'{ a: import("./a").User; b: import("./b").User; local: User }'
		const aliases = imported(
			`type User = { local: boolean }; type Routes = ${code}`
		)
		const result = schema(code, aliases)
		expect(result.properties?.a?.properties?.value).toEqual({
			type: 'string'
		})
		expect(result.properties?.b?.properties?.value).toEqual({
			type: 'number'
		})
		expect(result.properties?.local?.properties?.local).toEqual({
			type: 'boolean'
		})
	})

	it('resolves route imports inside an enclosing framework instance generic', () => {
		const aliases = imported(`
			import type { Framework } from "./framework";
			declare const app: Framework<{ response: import("./a").User }>;
		`)
		expect(schema('import("./a").User', aliases).properties?.value).toEqual(
			{ type: 'string' }
		)
	})

	it('inlines checker-resolved expressions directly inside emitted route types', () => {
		const aliases = imported(`
			import type { Framework } from "./framework";
			declare const levels: { view: 0; edit: 1 };
			declare const app: Framework<{ permission: keyof typeof levels }>;
		`)
		expect(schema('keyof typeof levels', aliases)).toEqual({
			anyOf: [
				{ const: 'view', type: 'string' },
				{ const: 'edit', type: 'string' }
			]
		})
	})

	it('does not fall back to a local alias when module resolution fails', () => {
		const code = 'import("missing").User'
		expect(
			schema(code, imported(`type User = string; type Routes = ${code}`))
		).not.toEqual({ type: 'string' })
	})

	it('follows renamed and star exports across barrels using tsconfig-relative paths', () => {
		const code = 'import("@models/barrel").PublicUser'
		const result = schema(code, imported(`type Routes = ${code}`))
		expect(result.properties?.value).toEqual({ type: 'string' })
	})

	it('uses supplied compiler paths when resolving imported types', () => {
		const code = 'import("@override/a").User'
		const declaration = `type Routes = ${code}`
		const aliases = resolveImportedTypes(
			declaration,
			fixture,
			'config/tsconfig.json',
			join(fixture, 'entry.ts'),
			extractTypeAliases(declaration),
			fs,
			{ baseUrl: fixture, paths: { '@override/*': ['./*'] } }
		)
		expect(schema(code, aliases).properties?.value).toEqual({
			type: 'string'
		})
	})

	it('resolves renamed named imports used by local aliases', () => {
		const declaration =
			'import type { User as Account } from "./a"; type Routes = { user: Account }'
		const result = schema('Routes', imported(declaration))
		expect(result.properties?.user?.properties?.value).toEqual({
			type: 'string'
		})
	})

	it('does not replace an unsupported imported interface with a same-named local alias', () => {
		const code = 'import("./unsupported").Payload'
		const aliases = imported(`type Private = string; type Routes = ${code}`)
		const result = schema(code, aliases)
		expect(result.properties?.value).not.toEqual({ type: 'string' })
	})

	it('does not resolve an unsupported enum using a same-named local alias', () => {
		const code = 'import("./unsupported").DynamicPayload'
		const aliases = imported(`type Dynamic = string; type Routes = ${code}`)
		expect(schema(code, aliases).properties?.value).not.toEqual({
			type: 'string'
		})
	})

	it('extracts aliases whose identifiers also exist on Object.prototype', () => {
		const aliases = extractTypeAliases(
			'type __proto__ = string; type constructor = number'
		)
		expect(schema('__proto__', aliases)).toEqual({ type: 'string' })
		expect(schema('constructor', aliases)).toEqual({ type: 'number' })
	})

	it('resolves enums and imported tuples through their defining module', () => {
		const code = 'import("./values").Payload'
		const result = schema(code, imported(`type Routes = ${code}`))
		expect(result.properties?.status).toEqual({
			anyOf: [
				{ const: 'ready', type: 'string' },
				{ const: 'done', type: 'string' }
			]
		})
		expect(result.properties?.code).toEqual({
			anyOf: [
				{ const: 4, type: 'number' },
				{ const: 5, type: 'number' }
			]
		})
	})

	it('resolves number indexing directly on an imported const tuple', () => {
		const code = '(typeof import("./value-data").statuses)[number]'
		expect(schema(code, imported(`type Routes = ${code}`))).toEqual({
			anyOf: [
				{ const: 'ready', type: 'string' },
				{ const: 'done', type: 'string' }
			]
		})
	})

	it('resolves Zod inference in source alias fields', () => {
		const code = 'import("./advanced").Widget'
		const result = schema(code, imported(`type Routes = ${code}`))
		expect(result.properties?.kind).toEqual({
			anyOf: [
				{ const: 'chart', type: 'string' },
				{ const: 'table', type: 'string' }
			]
		})
		expect(result.properties?.data?.properties?.title).toEqual({
			type: 'string'
		})
		expect(result.properties?.data?.properties?.count).toEqual({
			anyOf: [{ type: 'number' }, { type: 'null' }]
		})
	})

	it('keeps nested aliases in checker-inferred objects scoped to their source module', () => {
		const code = 'import("./advanced").NestedWidget'
		const result = schema(
			code,
			imported(`type Private = string; type Routes = ${code}`)
		)
		expect(result.properties?.metadata?.properties?.nested).toEqual({
			type: 'number'
		})
	})

	it('resolves keyof queries in the module that defines the value', () => {
		const code = 'import("./advanced").Permission'
		expect(schema(code, imported(`type Routes = ${code}`))).toEqual({
			anyOf: [
				{ const: 'view', type: 'string' },
				{ const: 'edit', type: 'string' }
			]
		})
	})

	it('resolves utility types applied to inferred source values', () => {
		const code = 'import("./advanced").PublicClient'
		expect(schema(code, imported(`type Routes = ${code}`))).toEqual({
			type: 'object',
			properties: {
				id: { type: 'string' },
				name: { anyOf: [{ type: 'string' }, { type: 'null' }] }
			},
			required: ['id', 'name']
		})
	})

	it('preserves supported collection syntax while resolving its inferred element types', () => {
		const code = 'import("./advanced").Preferences'
		const result = schema(code, imported(`type Routes = ${code}`))
		expect(
			result.properties?.keybinds?.patternProperties?.['^(.*)$']
		).toEqual({ type: 'string' })
		expect(
			result.properties?.dataById?.patternProperties?.['^(.*)$']
				?.properties?.title
		).toEqual({ type: 'string' })
	})

	it('does not erase unsupported generic arguments', () => {
		expect(
			inlineTypeReferences('External<string>', {
				External: '{ value: T }'
			})
		).toContain('External<string>')
	})

	it('keeps neighboring properties when imported generic types cannot be resolved', () => {
		const unresolved: string[] = []
		const result = inlineTypeReferences(
			'{ id: string; value: import("missing").Box<string> }',
			{},
			(name) => unresolved.push(name)
		)
		expect(JSON.parse(JSON.stringify(TypeBox(result)))).toEqual({
			type: 'object',
			properties: { id: { type: 'string' }, value: {} },
			required: ['id', 'value']
		})
		expect(unresolved).toEqual(['import("missing").Box<string>'])
	})

	it('gives qualified imports priority over the public bare-name fallback', () => {
		expect(
			schema('import("module").User', {
				'import("module").User': 'number',
				User: 'string'
			})
		).toEqual({ type: 'number' })
	})

	it('supports the public bare-name import fallback when no qualified alias exists', () => {
		expect(
			schema('import("missing").User', { User: '{ id: string }' })
				.properties.id
		).toEqual({ type: 'string' })
	})
})
