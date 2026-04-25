import { describe, it, expect } from 'bun:test'
import { Elysia, t } from 'elysia'

import { toOpenAPISchema } from '../../src/openapi'

const serializable = (
	a: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => JSON.parse(JSON.stringify(a))

describe('OpenAPI > references', () => {
	it('use references when schema is not available', () => {
		const app = new Elysia().get('/', () => {})

		const schema = toOpenAPISchema(app, undefined, {
			'/': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: {
						200: t.Object({
							name: t.Literal('lilith')
						})
					}
				}
			}
		})

		expect(serializable(schema)).toEqual({
			components: {
				schemas: {}
			},
			paths: {
				'/': {
					get: {
						operationId: 'getIndex',
						responses: {
							'200': {
								content: {
									'application/json': {
										schema: {
											properties: {
												name: {
													const: 'lilith',
													type: 'string'
												}
											},
											required: ['name'],
											type: 'object'
										}
									}
								},
								description: 'Response for status 200'
							}
						}
					}
				}
			}
		})
	})

	it('prefers schema over definition', () => {
		const app = new Elysia().get('/', () => ({ name: 'fouco' }) as const, {
			query: t.Object({
				id: t.Number()
			}),
			response: t.Object({
				name: t.Literal('fouco')
			})
		})

		const schema = toOpenAPISchema(app, undefined, {
			'/': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: {
						200: t.Object({
							name: t.Literal('lilith')
						})
					}
				}
			}
		})

		expect(serializable(schema)).toEqual({
			components: {
				schemas: {}
			},
			paths: {
				'/': {
					get: {
						operationId: 'getIndex',
						parameters: [
							{
								in: 'query',
								name: 'id',
								required: true,
								schema: {
									type: 'number'
								}
							}
						],
						responses: {
							'200': {
								content: {
									'application/json': {
										schema: {
											properties: {
												name: {
													const: 'fouco',
													type: 'string'
												}
											},
											required: ['name'],
											type: 'object'
										}
									}
								},
								description: 'Response for status 200'
							}
						}
					}
				}
			}
		})
	})

	it('use multiple references', () => {
		const app = new Elysia().get('/', () => {})

		const schema = toOpenAPISchema(app, undefined, [
			{
				'/': {
					get: {
						params: {} as any,
						query: {} as any,
						headers: {} as any,
						body: {} as any,
						response: {
							200: t.Object({
								name: t.Literal('lilith')
							})
						}
					}
				}
			},
			{
				'/': {
					get: {
						params: {} as any,
						query: t.Object({
							id: t.Number()
						}),
						headers: {} as any,
						body: {} as any,
						response: {}
					}
				}
			}
		])

		expect(serializable(schema)).toEqual({
			components: {
				schemas: {}
			},
			paths: {
				'/': {
					get: {
						operationId: 'getIndex',
						parameters: [
							{
								in: 'query',
								name: 'id',
								required: true,
								schema: {
									type: 'number'
								}
							}
						],
						responses: {
							'200': {
								content: {
									'application/json': {
										schema: {
											properties: {
												name: {
													const: 'lilith',
													type: 'string'
												}
											},
											required: ['name'],
											type: 'object'
										}
									}
								},
								description: 'Response for status 200'
							}
						}
					}
				}
			}
		})
	})
})

describe('OpenAPI > references > union-rooted schemas', () => {
	// Covers a regression where isValidSchema / unwrapSchema only accepted
	// schemas rooted at `type` / `properties` / `items`. Union-,
	// intersection-, const-, enum- and $ref-rooted schemas produced by
	// fromTypes were silently dropped at merge time.

	it('merges anyOf-rooted response schemas (union return type)', () => {
		const app = new Elysia().get('/best-key', () => {})

		const schema = toOpenAPISchema(app, undefined, {
			'/best-key': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: {
						200: {
							anyOf: [
								{
									type: 'object',
									patternProperties: {
										'^(.*)$': { type: 'string' }
									}
								},
								{
									type: 'object',
									required: ['key'],
									properties: { key: { type: 'null' } }
								}
							]
						} as any
					}
				}
			}
		})

		const paths = serializable(schema)?.paths as any
		const merged =
			paths['/best-key'].get.responses['200'].content[
				'application/json'
			].schema
		expect(merged.anyOf).toBeDefined()
		expect(merged.anyOf.length).toBe(2)
	})

	it('merges oneOf- and allOf-rooted response schemas', () => {
		const app = new Elysia().get('/x', () => {}).get('/y', () => {})

		const schema = toOpenAPISchema(app, undefined, {
			'/x': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: {
						200: {
							oneOf: [
								{ type: 'object', properties: { a: { type: 'string' } } },
								{ type: 'object', properties: { b: { type: 'number' } } }
							]
						} as any
					}
				}
			},
			'/y': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: {
						200: {
							allOf: [
								{ type: 'object', properties: { a: { type: 'string' } } },
								{ type: 'object', properties: { b: { type: 'number' } } }
							]
						} as any
					}
				}
			}
		})

		const paths = serializable(schema)?.paths as any
		expect(
			paths['/x'].get.responses['200'].content['application/json'].schema.oneOf
		).toBeDefined()
		expect(
			paths['/y'].get.responses['200'].content['application/json'].schema.allOf
		).toBeDefined()
	})

	it('merges const- and enum-rooted response schemas', () => {
		const app = new Elysia().get('/c', () => {}).get('/e', () => {})

		const schema = toOpenAPISchema(app, undefined, {
			'/c': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: { 200: { const: 'ok' } as any }
				}
			},
			'/e': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: { 200: { enum: ['a', 'b', 'c'] } as any }
				}
			}
		})

		const paths = serializable(schema)?.paths as any
		expect(
			paths['/c'].get.responses['200'].content['application/json'].schema.const
		).toBe('ok')
		expect(
			paths['/e'].get.responses['200'].content['application/json'].schema.enum
		).toEqual(['a', 'b', 'c'])
	})

	it('merges $ref-rooted response schemas', () => {
		const app = new Elysia().get('/r', () => {})

		const schema = toOpenAPISchema(app, undefined, {
			'/r': {
				get: {
					params: {} as any,
					query: {} as any,
					headers: {} as any,
					body: {} as any,
					response: {
						200: { $ref: '#/components/schemas/User' } as any
					}
				}
			}
		})

		const paths = serializable(schema)?.paths as any
		expect(
			paths['/r'].get.responses['200'].content['application/json'].schema.$ref
		).toBe('#/components/schemas/User')
	})
})
