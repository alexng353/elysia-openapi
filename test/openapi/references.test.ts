import { describe, it, expect } from 'bun:test'
import { Elysia, t } from 'elysia'

import { toOpenAPISchema } from '../../src/openapi'

const serializable = (
	a: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => JSON.parse(JSON.stringify(a))

describe('OpenAPI > references', () => {
	it.each(['3.0.3', '3.1.2'] as const)(
		'preserves nullable union responses when adding references in OpenAPI %s',
		(openapiVersion) => {
			const app = new Elysia().get('/nullable', () => null, {
				response: t.Union([t.String(), t.Null()])
			})
			const { paths } = toOpenAPISchema(
				app,
				undefined,
				{
					'/nullable': {
						get: {
							params: t.Object({}),
							query: t.Object({}),
							headers: t.Object({}),
							body: t.Object({}),
							response: {
								200: t.Number(),
								201: t.Literal('created')
							}
						}
					}
				},
				undefined,
				openapiVersion
			)
			const responses = paths['/nullable']!.get!.responses!
			expect(Object.keys(responses)).toEqual(['200', '201'])
			expect(responses['200']).toMatchObject({
				content:
					openapiVersion === '3.0.3'
						? {
								'text/plain': {
									schema: { type: 'string', nullable: true }
								}
							}
						: {
								'application/json': {
									schema: { type: ['string', 'null'] }
								}
							}
			})
			expect(responses['201']).toMatchObject({
				content: {
					'text/plain': {
						schema: { type: 'string', const: 'created' }
					}
				}
			})
		}
	)

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
