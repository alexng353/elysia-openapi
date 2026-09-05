import { describe, expect, it, spyOn } from 'bun:test'
import { Elysia } from 'elysia'
import SwaggerParser from '@apidevtools/swagger-parser'
import { openapi } from '../../src'
import { declarationToJSONSchema } from '../../src/gen'

const references = (type: string) =>
	declarationToJSONSchema(
		`{ example: { get: { response: { 200: ${type} } } } }`,
		undefined,
		{ silent: true }
	)
const schema = (type: string) =>
	JSON.parse(JSON.stringify(references(type)['/example'].get.response[200]))

describe('Gen > JSON representation boundaries', () => {
	it('omits undefined union members without widening optional properties', () => {
		expect(
			schema(
				'{ id?: string | undefined; count: number | undefined; nullable?: string | null | undefined }'
			)
		).toEqual({
			type: 'object',
			properties: {
				id: { type: 'string' },
				count: { type: 'number' },
				nullable: { anyOf: [{ type: 'string' }, { type: 'null' }] }
			}
		})
	})

	it('flattens optional unions introduced by alias expansion', () => {
		const result = declarationToJSONSchema(
			'{ example: { get: { response: { 200: Value } } } }',
			{
				Maybe: 'string | undefined',
				Value: '{ value: Maybe | null }'
			}
		)
		expect(
			JSON.parse(JSON.stringify(result['/example'].get.response[200]))
		).toEqual({
			type: 'object',
			properties: {
				value: { anyOf: [{ type: 'string' }, { type: 'null' }] }
			}
		})
	})

	it.each(['ReadonlyArray<string>', 'readonly string[]'])(
		'preserves the array element type for %s',
		(type) => {
			expect(schema(type)).toEqual({
				type: 'array',
				items: { type: 'string' }
			})
		}
	)

	it('preserves Readonly properties', () => {
		expect(schema('Readonly<{ id: string }>')).toEqual({
			type: 'object',
			properties: { id: { type: 'string' } },
			required: ['id']
		})
	})

	it.each([
		'{ [key: `x-${string}`]: number }',
		'Record<`x-${string}`, number>',
		'{ [key: number]: string }',
		'Record<number, string>',
		'[name: string, ...values: number[]]',
		'void',
		'bigint',
		'symbol',
		'undefined',
		'() => string',
		'Promise<string>'
	])(
		'keeps neighboring fields when %s has no supported JSON representation',
		(type) => {
			const warning = spyOn(console, 'warn').mockImplementation(() => {})
			try {
				const result = declarationToJSONSchema(
					`{ example: { get: { response: { 200: { id: string; value: ${type} } } } } }`
				)
				const resultSchema = JSON.parse(
					JSON.stringify(result['/example']?.get.response[200])
				)
				expect(resultSchema).toEqual({
					type: 'object',
					properties: { id: { type: 'string' }, value: {} },
					required: ['id', 'value']
				})
				expect(warning).toHaveBeenCalledTimes(1)
			} finally {
				warning.mockRestore()
			}
		}
	)

	it.each(['void', 'undefined'])(
		'emits no content for an inferred %s response',
		async (type) => {
			const app = new Elysia()
				.use(openapi({ provider: null, references: references(type) }))
				.get('/example', () => undefined)
			const spec = await (
				await app.handle(new Request('http://localhost/openapi/json'))
			).json()
			expect(spec.paths['/example'].get.responses[200]).toEqual({
				description: 'Response for status 200'
			})
		}
	)

	it.each(['3.0.3', '3.1.2'] as const)(
		'emits valid %s documents across unsupported JSON boundaries',
		async (openapiVersion) => {
			const app = new Elysia()
				.use(
					openapi({
						provider: null,
						openapiVersion,
						references: references(
							'{ id?: string | undefined; numberMap: Record<number, string>; big: bigint; promise: Promise<string>; callback: () => string; symbol: symbol }'
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
				].schema.properties.id
			).toEqual({ type: 'string' })
		}
	)
})
