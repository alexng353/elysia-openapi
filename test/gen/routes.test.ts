import { describe, expect, it, spyOn } from 'bun:test'
import { Elysia } from 'elysia'
import SwaggerParser from '@apidevtools/swagger-parser'
import { openapi } from '../../src'
import {
	declarationToJSONSchema,
	flattenNestedIntersections,
	extractGenericParam
} from '../../src/gen'

const response = (type: string) =>
	`{ params: {}; query: unknown; headers: unknown; body: unknown; response: { 200: ${type} } }`

describe('Gen > nested route declarations', () => {
	it.each(['3.0.3', '3.1.2'] as const)(
		'emits valid %s schemas for inferred dictionaries',
		async (openapiVersion) => {
			const app = new Elysia()
				.use(
					openapi({
						provider: null,
						openapiVersion,
						references: declarationToJSONSchema(
							`{ example: { get: ${response('{ [key: string]: Date }')} } }`
						)
					})
				)
				.get('/example', () => ({}))
			const spec = await (
				await app.handle(new Request('http://localhost/openapi/json'))
			).json()
			await SwaggerParser.validate(spec)
			expect(
				spec.paths['/example'].get.responses[200].content[
					'application/json'
				].schema.additionalProperties
			).toEqual({ type: 'string', format: 'date-time' })
		}
	)

	it.each(['200', 'default'])(
		'keeps a status-like path segment %s under /get/response',
		(segment) => {
			const result = declarationToJSONSchema(
				`{ get: { response: { "${segment}": { get: ${response('string')} } } } }`
			)
			expect(Object.keys(result)).toEqual([`/get/response/${segment}`])
			expect(
				result[`/get/response/${segment}`].get.response[200]
			).toMatchObject({ type: 'string' })
		}
	)

	it('merges method and status-map intersections without flattening response bodies', () => {
		const result = declarationToJSONSchema(`{ example: { get:
			{ response: { 200: { id: string } & { name: string } } & { 404: string } }
			& { query: { search: string } }
		} }`)
		expect(result['/example'].get).toMatchObject({
			query: { properties: { search: { type: 'string' } } },
			response: {
				200: {
					allOf: [
						{ properties: { id: { type: 'string' } } },
						{ properties: { name: { type: 'string' } } }
					]
				},
				404: { type: 'string' }
			}
		})
	})

	it('bounds unresolved diagnostics and honors silent mode', () => {
		const warning = spyOn(console, 'warn').mockImplementation(() => {})
		try {
			const type = `{ ${Array.from({ length: 12 }, (_, i) => `field${i}: Missing${i}<"${'x'.repeat(1000)}">`).join('; ')} }`
			const declaration = `{ example: { get: ${response(type)} } }`
			declarationToJSONSchema(declaration)
			expect(warning).toHaveBeenCalledTimes(1)
			expect(warning.mock.calls[0][0].length).toBeLessThan(1500)
			expect(warning.mock.calls[0][0]).toContain('2 more')
			warning.mockClear()
			declarationToJSONSchema(declaration, undefined, { silent: true })
			expect(warning).not.toHaveBeenCalled()
		} finally {
			warning.mockRestore()
		}
	})

	it('preserves inferred index signatures and their neighboring fields', () => {
		const result = declarationToJSONSchema(
			`{ checks: { get: ${response(`{
			id: string;
			values: { [key: string]: { ok: boolean } };
			mixed: { [key: string]: number; count: number };
		}`)} } }`
		)
		expect(result['/checks'].get.response?.[200]).toMatchObject({
			properties: {
				id: { type: 'string' },
				values: {
					type: 'object',
					additionalProperties: {
						properties: { ok: { type: 'boolean' } }
					}
				},
				mixed: {
					allOf: [
						{ properties: { count: { type: 'number' } } },
						{ additionalProperties: { type: 'number' } }
					]
				}
			}
		})
	})

	it('omits non-JSON symbol brands without losing the primitive type', () => {
		const result = declarationToJSONSchema(
			`{ sessions: { get: ${response('{ id: string & { [$brand]: { SessionId: true } }; active: boolean }')} } }`
		)
		expect(result['/sessions'].get.response?.[200]).toMatchObject({
			properties: { id: { type: 'string' }, active: { type: 'boolean' } }
		})
	})

	it('ignores generic delimiters inside literals and function types', () => {
		const routes = '{ get: { response: { 200: "a>b,c<d" } } }'
		expect(
			extractGenericParam(
				`: Elysia<"", {}, { run: () => string }, {}, ${routes}, {}>`,
				4
			)
		).toBe(routes)
	})
	it('distinguishes a route named get/response from HTTP method metadata', () => {
		const result = declarationToJSONSchema(
			`{ get: { response: { get: ${response('string')} } } }`
		)
		expect(Object.keys(result)).toEqual(['/get/response'])
		expect(result['/get/response'].get.response?.[200]).toMatchObject({
			type: 'string'
		})
	})

	it('retains neighboring fields when an external generic cannot be represented', () => {
		const result = declarationToJSONSchema(
			`{ users: { get: ${response('{ id: string; data: External<typeof Model> }')} } }`
		)
		expect(result['/users'].get.response?.[200]).toMatchObject({
			properties: { id: { type: 'string' }, data: {} }
		})
		expect(JSON.stringify(result)).not.toContain('$ref')
	})
	it('extracts every nested plugin route and method', () => {
		const result = declarationToJSONSchema(`{
			api: {
				v1: { users: { get: ${response('{ id: string }')} } }
				& { teams: { get: ${response('{ team: string }')}; post: ${response('{ created: boolean }')} } }
			}
		}`)
		expect(Object.keys(result).sort()).toEqual([
			'/api/v1/teams',
			'/api/v1/users'
		])
		expect(result['/api/v1/teams'].post.response?.[200]).toMatchObject({
			properties: { created: { type: 'boolean' } }
		})
		expect(result['/api/v1/users'].get.response?.[200]).toMatchObject({
			properties: { id: { type: 'string' } }
		})
	})

	it('preserves intersections inside response schemas', () => {
		const result = declarationToJSONSchema(`{
			users: { get: ${response('{ id: string } & { name: string }')} }
		}`)
		expect(result['/users'].get.response?.[200]).toMatchObject({
			allOf: [
				{ properties: { id: { type: 'string' } } },
				{ properties: { name: { type: 'string' } } }
			]
		})
	})

	it('keeps quoted route segments and literal values intact', () => {
		const result = declarationToJSONSchema(`{
			"readonly-items": { "get": ${response('{ readonlyName: "readonly"; syntax: "} & {" }')} }
		}`)
		expect(result['/readonly-items'].get.response?.[200]).toMatchObject({
			properties: {
				readonlyName: { const: 'readonly' },
				syntax: { const: '} & {' }
			}
		})
	})

	it('expands independent nested plugins without multiplying siblings', () => {
		const plugins = Array.from(
			{ length: 5 },
			(_, i) =>
				`{ group${i}: { a: { get: ${response('string')} } } & { b: { get: ${response('number')} } } }`
		).join(' & ')
		const declaration = `{ api: ${plugins} }`
		const flattened = flattenNestedIntersections(declaration)
		expect(flattened.length).toBeLessThan(declaration.length * 3)
		expect(Object.keys(declarationToJSONSchema(declaration))).toHaveLength(
			10
		)
	})

	it('represents Date values without rewriting string literals', () => {
		const result = declarationToJSONSchema(`{
			dates: { get: ${response('{ created: Date; history: Date[]; optional: Date | null; literal: "Date"; marker: "__DATETIME__" }')} }
		}`)
		expect(result['/dates'].get.response?.[200]).toMatchObject({
			properties: {
				created: { type: 'string', format: 'date-time' },
				history: {
					type: 'array',
					items: { type: 'string', format: 'date-time' }
				},
				optional: {
					anyOf: [
						{ type: 'string', format: 'date-time' },
						{ type: 'null' }
					]
				},
				literal: { const: 'Date' },
				marker: { const: '__DATETIME__' }
			}
		})
	})
})
