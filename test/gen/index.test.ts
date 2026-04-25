import { describe, it, expect } from 'bun:test'

import {
	declarationToJSONSchema,
	extractRootObjects,
	extractTypeAliases,
	inlineTypeReferences,
	flattenNestedIntersections,
	fromTypes,
	rewriteIndexSignatures,
	stripUnresolvedUnionMembers,
	transformDateTypes,
	transformWebApiGlobals
} from '../../src/gen'

const serializable = (
	a: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => JSON.parse(JSON.stringify(a))

describe('Gen > Type Gen', () => {
	it('parse declaration to TypeScript', () => {
		const reference = declarationToJSONSchema(`
			{
				hello: {
					world: {
						get: {
							params: {}
							query: {}
							headers: {}
							body: {}
							response: {
								200: {
									name: string
								}
							}
						}
					}
				}
			}`)

		expect(serializable(reference)!).toEqual({
			'/hello/world': {
				get: {
					body: {
						properties: {},
						type: 'object'
					},
					headers: {
						properties: {},
						type: 'object'
					},
					params: {
						properties: {},
						type: 'object'
					},
					query: {
						properties: {},
						type: 'object'
					},
					response: {
						'200': {
							properties: {
								name: {
									type: 'string'
								}
							},
							required: ['name'],
							type: 'object'
						}
					}
				}
			}
		})
	})

	it('parse multiple declaration to TypeScript', () => {
		const reference = declarationToJSONSchema(`
			{
				hello: {
					world: {
						get: {
							params: {}
							query: {}
							headers: {}
							body: {}
							response: {
								200: {
									name: string
								}
							}
						}
					}
				}
				hi: {
					world: {
						get: {
							params: {}
							query: {}
							headers: {}
							body: {}
							response: {
								200: {
									name: string
								}
							}
						}
					}
				}
			}`)

		const property = {
			get: {
				body: {
					properties: {},
					type: 'object'
				},
				headers: {
					properties: {},
					type: 'object'
				},
				params: {
					properties: {},
					type: 'object'
				},
				query: {
					properties: {},
					type: 'object'
				},
				response: {
					'200': {
						properties: {
							name: {
								type: 'string'
							}
						},
						required: ['name'],
						type: 'object'
					}
				}
			}
		}

		expect(serializable(reference)!).toEqual({
			'/hello/world': property,
			'/hi/world': property
		})
	})

	it('parse intersect declaration to TypeScript', () => {
		const reference = declarationToJSONSchema(`
			{
				hello: {
					world: {
						get: {
							params: {}
							query: {}
							headers: {}
							body: {}
							response: {
								200: {
									name: string
								}
							}
						}
					}
				}
			} & {
				hi: {
					world: {
						get: {
							params: {}
							query: {}
							headers: {}
							body: {}
							response: {
								200: {
									name: string
								}
							}
						}
					}
				}
			}`)

		const property = {
			get: {
				body: {
					properties: {},
					type: 'object'
				},
				headers: {
					properties: {},
					type: 'object'
				},
				params: {
					properties: {},
					type: 'object'
				},
				query: {
					properties: {},
					type: 'object'
				},
				response: {
					'200': {
						properties: {
							name: {
								type: 'string'
							}
						},
						required: ['name'],
						type: 'object'
					}
				}
			}
		}

		expect(serializable(reference)!).toEqual({
			'/hello/world': property,
			'/hi/world': property
		})
	})

	it('add quote to special character while parsing declaration to TypeScript', () => {
		const reference = declarationToJSONSchema(`
			{
				"hello-world": {
					2: {
						get: {
							params: {}
							query: {}
							headers: {}
							body: {}
							response: {
								200: {
									name: string
								}
							}
						}
					}
				}
				"ไม่ใช่อังกฤษ": {
					get: {
						params: {}
						query: {}
						headers: {}
						body: {}
						response: {
							200: {
								name: string
							}
							404: {
								message: string
							}
						}
					}
				}
			}`)

		const property = {
			get: {
				body: {
					properties: {},
					type: 'object'
				},
				headers: {
					properties: {},
					type: 'object'
				},
				params: {
					properties: {},
					type: 'object'
				},
				query: {
					properties: {},
					type: 'object'
				},
				response: {
					'200': {
						properties: {
							name: {
								type: 'string'
							}
						},
						required: ['name'],
						type: 'object'
					}
				}
			}
		}

		expect(serializable(reference)!).toEqual({
			'/hello-world/2': {
				get: {
					body: {
						properties: {},
						type: 'object'
					},
					headers: {
						properties: {},
						type: 'object'
					},
					params: {
						properties: {},
						type: 'object'
					},
					query: {
						properties: {},
						type: 'object'
					},
					response: {
						'200': {
							properties: {
								name: {
									type: 'string'
								}
							},
							required: ['name'],
							type: 'object'
						}
					}
				}
			},
			'/ไม่ใช่อังกฤษ': {
				get: {
					body: {
						properties: {},
						type: 'object'
					},
					headers: {
						properties: {},
						type: 'object'
					},
					params: {
						properties: {},
						type: 'object'
					},
					query: {
						properties: {},
						type: 'object'
					},
					response: {
						'200': {
							properties: {
								name: {
									type: 'string'
								}
							},
							required: ['name'],
							type: 'object'
						},
						'404': {
							properties: {
								message: {
									type: 'string'
								}
							},
							required: ['message'],
							type: 'object'
						}
					}
				}
			}
		})
	})

	it('handle readonly property, and readonly array', () => {
		const reference = declarationToJSONSchema(`
				{
					hello: {
						world: {
							get: {
								params: {}
								query: {}
								headers: {}
								body: {}
								response: {
									200: {
										readonly name: "Lilith"
										readonly friends: readonly ["Sartre", "Fouco"]
									}
								}
							}
						}
					}
				}`)

		expect(serializable(reference)!).toEqual({
			'/hello/world': {
				get: {
					body: {
						properties: {},
						type: 'object'
					},
					headers: {
						properties: {},
						type: 'object'
					},
					params: {
						properties: {},
						type: 'object'
					},
					query: {
						properties: {},
						type: 'object'
					},
					response: {
						'200': {
							properties: {
								friends: {
									additionalItems: false,
									items: [
										{
											const: 'Sartre',
											type: 'string'
										},
										{
											const: 'Fouco',
											type: 'string'
										}
									],
									maxItems: 2,
									minItems: 2,
									type: 'array'
								},
								name: {
									const: 'Lilith',
									type: 'string'
								}
							},
							required: ['name', 'friends'],
							type: 'object'
						}
					}
				}
			}
		})
	})

	it('integrate', async () => {
		const reference = fromTypes('test/gen/sample.ts')()

		expect(serializable(reference)!).toEqual({
			'/': {
				get: {
					body: {},
					headers: {},
					params: {
						properties: {},
						type: 'object'
					},
					query: {},
					response: {
						'204': {},
						'422': {
							properties: {
								expected: {
									type: 'string'
								},
								found: {},
								message: {
									type: 'string'
								},
								on: {
									type: 'string'
								},
								property: {
									type: 'string'
								},
								summary: {
									type: 'string'
								},
								type: {
									const: 'validation',
									type: 'string'
								}
							},
							required: ['type', 'on'],
							type: 'object'
						}
					}
				}
			},
			'/character': {
				post: {
					body: {
						type: 'string'
					},
					headers: {},
					params: {
						properties: {},
						type: 'object'
					},
					query: {},
					response: {
						'200': {
							properties: {
								name: {
									const: 'Lilith',
									type: 'string'
								}
							},
							required: ['name'],
							type: 'object'
						},
						'422': {
							properties: {
								expected: {
									type: 'string'
								},
								found: {},
								message: {
									type: 'string'
								},
								on: {
									type: 'string'
								},
								property: {
									type: 'string'
								},
								summary: {
									type: 'string'
								},
								type: {
									const: 'validation',
									type: 'string'
								}
							},
							required: ['type', 'on'],
							type: 'object'
						}
					}
				}
			},
			'/const': {
				get: {
					body: {},
					headers: {},
					params: {
						properties: {},
						type: 'object'
					},
					query: {},
					response: {
						'200': {
							properties: {
								friends: {
									additionalItems: false,
									items: [
										{
											const: 'Sartre',
											type: 'string'
										},
										{
											const: 'Fouco',
											type: 'string'
										}
									],
									maxItems: 2,
									minItems: 2,
									type: 'array'
								},
								name: {
									const: 'Lilith',
									type: 'string'
								}
							},
							required: ['name', 'friends'],
							type: 'object'
						}
					}
				}
			},
			'/json': {
				post: {
					body: {
						properties: {
							hello: {
								type: 'string'
							}
						},
						required: ['hello'],
						type: 'object'
					},
					headers: {},
					params: {
						properties: {},
						type: 'object'
					},
					query: {},
					response: {
						'200': {
							properties: {
								hello: {
									type: 'string'
								}
							},
							required: ['hello'],
							type: 'object'
						},
						'418': {
							const: "I'm a teapot",
							type: 'string'
						},
						'422': {
							properties: {
								expected: {
									type: 'string'
								},
								found: {},
								message: {
									type: 'string'
								},
								on: {
									type: 'string'
								},
								property: {
									type: 'string'
								},
								summary: {
									type: 'string'
								},
								type: {
									const: 'validation',
									type: 'string'
								}
							},
							required: ['type', 'on'],
							type: 'object'
						}
					}
				}
			},
			'/no-manual': {
				get: {
					body: {},
					headers: {},
					params: {
						properties: {},
						type: 'object'
					},
					query: {},
					response: {
						'200': {
							properties: {
								name: {
									type: 'string'
								}
							},
							required: ['name'],
							type: 'object'
						}
					}
				}
			}
		})
	})
})

describe('Gen > numberKey regex', () => {
	it('does not replace digits inside identifiers like v4', () => {
		const reference = declarationToJSONSchema(`{
			api: {
				v4: {
					getUser: {
						post: {
							params: {}
							query: unknown
							headers: unknown
							body: { id: string }
							response: {
								200: { name: string }
							}
						}
					}
				}
			}
		}`)

		expect(serializable(reference)!).toEqual({
			'/api/v4/getUser': {
				post: {
					params: {
						properties: {},
						type: 'object'
					},
					query: {},
					headers: {},
					body: {
						properties: {
							id: { type: 'string' }
						},
						required: ['id'],
						type: 'object'
					},
					response: {
						'200': {
							properties: {
								name: { type: 'string' }
							},
							required: ['name'],
							type: 'object'
						}
					}
				}
			}
		})
	})

	it('still replaces standalone numeric keys in response codes', () => {
		const reference = declarationToJSONSchema(`{
			users: {
				get: {
					params: {}
					query: unknown
					headers: unknown
					body: unknown
					response: {
						200: { id: string }
						404: { message: string }
					}
				}
			}
		}`)

		expect(serializable(reference)!['/users']).toBeDefined()
		const responses = (serializable(reference)!['/users'] as any).get
			.response
		expect(responses['200']).toBeDefined()
		expect(responses['404']).toBeDefined()
	})

	it('handles mixed numeric and alphanumeric path segments', () => {
		const reference = declarationToJSONSchema(`{
			api: {
				v2: {
					items: {
						get: {
							params: {}
							query: unknown
							headers: unknown
							body: unknown
							response: {
								200: { count: number }
							}
						}
					}
				}
			}
		}`)

		expect(serializable(reference)!).toHaveProperty('/api/v2/items')
	})
})

describe('Gen > extractTypeAliases', () => {
	it('extracts a simple type alias', () => {
		const aliases = extractTypeAliases(
			'type User = { id: string; name: string; };'
		)
		expect(aliases).toHaveProperty('User')
		expect(aliases.User).toBe('{ id: string; name: string; }')
	})

	it('extracts multiple type aliases', () => {
		const decl = `
type User = { id: string; name: string; };
type Post = { title: string; body: string; };
`
		const aliases = extractTypeAliases(decl)
		expect(Object.keys(aliases)).toEqual(['User', 'Post'])
		expect(aliases.User).toBe('{ id: string; name: string; }')
		expect(aliases.Post).toBe('{ title: string; body: string; }')
	})

	it('handles nested braces in type bodies', () => {
		const aliases = extractTypeAliases(
			'type Nested = { inner: { deep: string; }; outer: number; };'
		)
		expect(aliases.Nested).toBe(
			'{ inner: { deep: string; }; outer: number; }'
		)
	})

	it('captures non-object type aliases (Record, unions, primitives)', () => {
		const aliases = extractTypeAliases(`
			type Name = string;
			type Dict = Record<string, number>;
			type Either = Foo | Bar;
		`)
		expect(aliases.Name).toBe('string')
		expect(aliases.Dict).toBe('Record<string, number>')
		expect(aliases.Either).toBe('Foo | Bar')
	})

	it('skips typeof aliases since TypeBox cannot resolve them', () => {
		const aliases = extractTypeAliases(`
			declare const app: any;
			type App = typeof app;
			type Keep = { id: string };
		`)
		expect(aliases.App).toBeUndefined()
		expect(aliases.Keep).toBeDefined()
	})

	it('captures interface declarations', () => {
		const aliases = extractTypeAliases(
			'export interface User { id: string; name: string; }'
		)
		expect(aliases.User).toBe('{ id: string; name: string; }')
	})

	it('captures interfaces with extends clauses', () => {
		const aliases = extractTypeAliases(`
			interface Base { id: string; }
			interface User extends Base { name: string; }
		`)
		expect(aliases.User).toBe('{ name: string; }')
	})

	it('captures generic interfaces', () => {
		const aliases = extractTypeAliases(
			'interface Page<T> { items: T[]; total: number; }'
		)
		expect(aliases.Page).toBe('{ items: T[]; total: number; }')
	})

	it('captures interfaces with nested object members', () => {
		const aliases = extractTypeAliases(
			'interface Nested { inner: { deep: string; }; outer: number; }'
		)
		expect(aliases.Nested).toBe(
			'{ inner: { deep: string; }; outer: number; }'
		)
	})

	it('does not overwrite a type alias when an interface of the same name follows', () => {
		const aliases = extractTypeAliases(`
			type Foo = { fromType: true; };
			interface Foo { fromInterface: true; }
		`)
		expect(aliases.Foo).toBe('{ fromType: true; }')
	})

	it('captures both type aliases and interfaces in the same source', () => {
		const aliases = extractTypeAliases(`
			type Alias = { kind: 'alias'; };
			interface Iface { kind: 'iface'; }
		`)
		expect(aliases.Alias).toBe(`{ kind: 'alias'; }`)
		expect(aliases.Iface).toBe(`{ kind: 'iface'; }`)
	})
})

describe('Gen > inlineTypeReferences', () => {
	it('replaces type references with their definitions', () => {
		const result = inlineTypeReferences('200: User', {
			User: '{ id: string; name: string; }'
		})
		expect(result).toBe('200: { id: string; name: string; }')
	})

	it('replaces multiple references', () => {
		const result = inlineTypeReferences('200: User; 404: ErrorBody', {
			User: '{ name: string; }',
			ErrorBody: '{ message: string; }'
		})
		expect(result).toBe(
			'200: { name: string; }; 404: { message: string; }'
		)
	})

	it('does not replace partial matches inside other identifiers', () => {
		const result = inlineTypeReferences('200: UserProfile', {
			User: '{ id: string; }'
		})
		// UserProfile should NOT be partially replaced
		expect(result).toBe('200: UserProfile')
	})

	it('replaces longer names first to avoid partial matches', () => {
		const result = inlineTypeReferences('a: AdminUser; b: Admin', {
			Admin: '{ role: string; }',
			AdminUser: '{ role: string; name: string; }'
		})
		expect(result).toBe(
			'a: { role: string; name: string; }; b: { role: string; }'
		)
	})
})

describe('Gen > type alias inlining through declarationToJSONSchema', () => {
	it('inlines type aliases into response schemas', () => {
		const typeAliases = {
			User: '{ id: string; name: string; email: string; }'
		}
		const reference = declarationToJSONSchema(
			`{
				api: {
					v4: {
						getUser: {
							post: {
								params: {}
								query: unknown
								headers: unknown
								body: { id: string }
								response: {
									200: User
								}
							}
						}
					}
				}
			}`,
			typeAliases
		)

		const route = serializable(reference)!['/api/v4/getUser'] as any
		expect(route.post.response['200']).toEqual({
			properties: {
				id: { type: 'string' },
				name: { type: 'string' },
				email: { type: 'string' }
			},
			required: ['id', 'name', 'email'],
			type: 'object'
		})
	})

	it('inlines multiple type aliases in the same declaration', () => {
		const typeAliases = {
			User: '{ id: string; name: string; }',
			ErrorResponse: '{ message: string; code: number; }'
		}
		const reference = declarationToJSONSchema(
			`{
				users: {
					get: {
						params: {}
						query: unknown
						headers: unknown
						body: unknown
						response: {
							200: User
							400: ErrorResponse
						}
					}
				}
			}`,
			typeAliases
		)

		const route = serializable(reference)!['/users'] as any
		expect(route.get.response['200']).toEqual({
			properties: {
				id: { type: 'string' },
				name: { type: 'string' }
			},
			required: ['id', 'name'],
			type: 'object'
		})
		expect(route.get.response['400']).toEqual({
			properties: {
				message: { type: 'string' },
				code: { type: 'number' }
			},
			required: ['message', 'code'],
			type: 'object'
		})
	})

	it('works with nested type aliases in body and response', () => {
		const typeAliases = {
			CreateUserInput: '{ name: string; email: string; }',
			User: '{ id: string; name: string; email: string; createdAt: string; }'
		}
		const reference = declarationToJSONSchema(
			`{
				users: {
					post: {
						params: {}
						query: unknown
						headers: unknown
						body: CreateUserInput
						response: {
							201: User
						}
					}
				}
			}`,
			typeAliases
		)

		const route = serializable(reference)!['/users'] as any
		expect(route.post.body).toEqual({
			properties: {
				name: { type: 'string' },
				email: { type: 'string' }
			},
			required: ['name', 'email'],
			type: 'object'
		})
		expect(route.post.response['201']).toEqual({
			properties: {
				id: { type: 'string' },
				name: { type: 'string' },
				email: { type: 'string' },
				createdAt: { type: 'string' }
			},
			required: ['id', 'name', 'email', 'createdAt'],
			type: 'object'
		})
	})
})

describe('Gen > route section trimming', () => {
	it('only extracts routes from the routes param, ignoring trailing generic params', () => {
		// Simulates what fromTypes extracts: the routes param followed by
		// additional generic params like `}, { derive: {}; resolve: {}; ... }, ...`
		// The trimming should stop at the first top-level closing brace.
		const routeSection = `{
			users: {
				get: {
					params: {}
					query: unknown
					headers: unknown
					body: unknown
					response: {
						200: { id: string; name: string }
					}
				}
			}
		}`

		const reference = declarationToJSONSchema(routeSection)
		const keys = Object.keys(serializable(reference)!)
		expect(keys).toEqual(['/users'])
	})

	it('extractRootObjects handles single top-level object', () => {
		const objects = extractRootObjects(`{
			api: {
				users: {
					get: {
						response: { 200: { id: string } }
					}
				}
			}
		}`)

		expect(objects.length).toBe(1)
	})
})

describe('Gen > import() type references', () => {
	it('strips import("...") prefix and inlines resolved type aliases', () => {
		const typeAliases = {
			Update: '{ type: string; timestamp: string; }'
		}
		const reference = declarationToJSONSchema(
			`{
			users: {
				get: {
					params: {}
					query: unknown
					headers: unknown
					body: unknown
					response: {
						200: {
							id: string;
							updates: import("@futurity/db/schema/common.types").Update[] | null;
						}
					}
				}
			}
		}`,
			typeAliases
		)

		const route = serializable(reference)!['/users'] as any
		expect(route.get.response['200'].properties.id).toEqual({
			type: 'string'
		})
		// import(...).Update[] | null resolves to the inlined type
		expect(route.get.response['200'].properties.updates).toEqual({
			anyOf: [
				{
					type: 'array',
					items: {
						type: 'object',
						required: ['type', 'timestamp'],
						properties: {
							type: { type: 'string' },
							timestamp: { type: 'string' }
						}
					}
				},
				{ type: 'null' }
			]
		})
	})

	it('falls back gracefully when import type is not in aliases', () => {
		// Without typeAliases, the import reference becomes just the type name
		// which TypeBox treats as an unresolvable reference
		const reference = declarationToJSONSchema(`{
			users: {
				get: {
					params: {}
					query: unknown
					headers: unknown
					body: unknown
					response: {
						200: {
							id: string;
							updates: import("some/module").Unknown[] | null;
						}
					}
				}
			}
		}`)

		const route = serializable(reference)!['/users'] as any
		expect(route.get.response['200'].properties.id).toEqual({
			type: 'string'
		})
		// Unresolved type still produces a schema (TypeBox $ref)
		expect(route.get.response['200'].properties.updates).toBeDefined()
	})

	it('handles complex Drizzle-derived types with nullable fields and unions', () => {
		const reference = declarationToJSONSchema(`{
			api: {
				v4: {
					getUser: {
						post: {
							params: {}
							query: unknown
							headers: unknown
							body: { id: string }
							response: {
								200: {
									id: string;
									name: string;
									email: string;
									organization_id: string | null;
									is_email_verified: boolean;
									known_ips: string[] | null;
									preferences: {
										defaultDashboardId?: string | null;
										developerModeEnabled?: boolean;
										keybinds?: Record<string, string>;
									} | null;
									type: "internal" | "external";
								}
							}
						}
					}
				}
			}
		}`)

		const route = serializable(reference)!['/api/v4/getUser'] as any
		const schema = route.post.response['200']

		// Basic string fields
		expect(schema.properties.id).toEqual({ type: 'string' })
		expect(schema.properties.email).toEqual({ type: 'string' })

		// string | null union
		expect(schema.properties.organization_id).toEqual({
			anyOf: [{ type: 'string' }, { type: 'null' }]
		})

		// boolean
		expect(schema.properties.is_email_verified).toEqual({
			type: 'boolean'
		})

		// string[] | null
		expect(schema.properties.known_ips).toEqual({
			anyOf: [
				{ type: 'array', items: { type: 'string' } },
				{ type: 'null' }
			]
		})

		// Nested object | null with optional fields
		expect(schema.properties.preferences.anyOf).toBeDefined()

		// String literal union
		expect(schema.properties.type).toEqual({
			anyOf: [
				{ const: 'internal', type: 'string' },
				{ const: 'external', type: 'string' }
			]
		})
	})
})

describe('Gen > rewriteIndexSignatures', () => {
	it('rewrites a pure index signature to Record<string, T>', () => {
		const result = rewriteIndexSignatures('{ [key: string]: number }')
		expect(result).toBe('Record<string, number>')
	})

	it('handles nested index signatures', () => {
		const result = rewriteIndexSignatures(
			'{ [key: string]: { [k: string]: number } }'
		)
		expect(result).toBe('Record<string, Record<string, number>>')
	})

	it('leaves objects with extra properties alone', () => {
		const input = '{ [key: string]: number; foo: string }'
		expect(rewriteIndexSignatures(input)).toBe(input)
	})

	it('rewrites index signatures inside route declarations so TypeBox emits schemas', () => {
		const schema = declarationToJSONSchema(
			`{ api: { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: { [key: string]: string } } } } }`
		)
		const response200 = serializable(
			schema['/api']?.get?.response?.['200']
		)
		expect(response200).toEqual({
			type: 'object',
			patternProperties: {
				'^(.*)$': { type: 'string' }
			}
		})
	})
})

describe('Gen > stripUnresolvedUnionMembers', () => {
	it('drops a union member that is not a builtin and not in typeAliases', () => {
		const code = `{ response: { 200: SomeUnresolvedType | "literal"; }; }`
		const result = stripUnresolvedUnionMembers(code, {})
		expect(result).toContain('"literal"')
		expect(result).not.toContain('SomeUnresolvedType')
	})

	it('keeps union members that resolve via typeAliases', () => {
		const code = `{ response: { 200: KnownType | "literal"; }; }`
		const result = stripUnresolvedUnionMembers(code, {
			KnownType: '{ id: string }'
		})
		expect(result).toContain('KnownType')
	})

	it('leaves the union intact when every member is unresolvable', () => {
		const code = `{ response: { 200: UnknownA | UnknownB; }; }`
		const result = stripUnresolvedUnionMembers(code, {})
		expect(result).toBe(code)
	})
})

describe('Gen > transformDateTypes', () => {
	it('rewrites {type:"Date"} to string + date-time format', () => {
		const result = transformDateTypes({ type: 'Date' })
		expect(result).toEqual({ type: 'string', format: 'date-time' })
	})

	it('recurses into object properties', () => {
		const result = transformDateTypes({
			type: 'object',
			properties: {
				createdAt: { type: 'Date' },
				name: { type: 'string' }
			}
		})
		expect(result.properties.createdAt).toEqual({
			type: 'string',
			format: 'date-time'
		})
		expect(result.properties.name).toEqual({ type: 'string' })
	})

	it('recurses into array items and anyOf/oneOf/allOf', () => {
		const result = transformDateTypes({
			anyOf: [
				{ type: 'Date' },
				{ type: 'array', items: { type: 'Date' } }
			]
		})
		expect(result.anyOf[0]).toEqual({
			type: 'string',
			format: 'date-time'
		})
		expect(result.anyOf[1].items).toEqual({
			type: 'string',
			format: 'date-time'
		})
	})
})

describe('Gen > undefined to null normalization', () => {
	it('rewrites `| undefined` in optional fields to nullable schema', () => {
		const schema = declarationToJSONSchema(
			`{ api: { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: { icon: string | undefined } } } } }`
		)
		const icon = serializable(
			schema['/api']?.get?.response?.['200']?.properties?.icon
		)
		expect(icon).toEqual({
			anyOf: [{ type: 'string' }, { type: 'null' }]
		})
	})
})

describe('Gen > ReturnType<typeof> fallback', () => {
	it('replaces unresolvable ReturnType<typeof fn> with unknown so the route still emits', () => {
		const schema = declarationToJSONSchema(
			`{ api: { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: { items: ReturnType<typeof build>[number][] } } } } }`
		)
		const response200 = schema['/api']?.get?.response?.['200']
		expect(response200).toBeDefined()
		expect(response200.type).toBe('object')
		expect(response200.properties.items).toBeDefined()
	})
})

describe('Gen > inlineTypeReferences iterates to fixed point', () => {
	it('resolves aliases that reference other aliases in a single call', () => {
		const aliases = {
			Outer: '{ inner: Inner }',
			Inner: '{ id: string }'
		}
		const result = inlineTypeReferences('200: Outer', aliases)
		expect(result).toContain('id: string')
		expect(result).not.toContain('Inner')
		expect(result).not.toContain('Outer')
	})

	it('guards against self-referential aliases without looping', () => {
		const aliases = { Node: '{ children: Node[] }' }
		const result = inlineTypeReferences('200: Node', aliases)
		// Self-ref is detected and skipped; body stays as-is
		expect(result).toBe('200: Node')
	})
})

describe('Gen > flattenNestedIntersections', () => {
	it('distributes a nested `} & {` inside a property over the outer object', () => {
		const input = `{ api: { v3: { a: { get: {} } } & { b: { post: {} } } } }`
		const result = flattenNestedIntersections(input)
		// Two top-level intersected objects, each with a single route
		const parts = result.split('&').map((s) => s.trim())
		expect(parts.length).toBeGreaterThanOrEqual(2)
		expect(parts.some((p) => p.includes('a:') && !p.includes('b:'))).toBe(
			true
		)
		expect(parts.some((p) => p.includes('b:') && !p.includes('a:'))).toBe(
			true
		)
	})

	it('produces one root object per route so extractRootObjects sees each individually', () => {
		const input = `{ api: { v3: { a: { get: {} } } & { b: { post: {} } } } }`
		const flattened = flattenNestedIntersections(input)
		const roots = extractRootObjects(flattened)
		// One root per distributed member
		expect(roots.length).toBeGreaterThanOrEqual(2)
	})

	it('leaves a declaration without nested intersections unchanged', () => {
		const input = `{ api: { users: { get: {} } } }`
		expect(flattenNestedIntersections(input)).toBe(input)
	})

	it('deduplicates outputs when sibling intersections cross-product', () => {
		// Sibling properties each carrying their own intersection used to
		// produce N x M cross-products with many duplicate leaf routes. With
		// dedup, each distinct leaf appears at most once.
		const input = `{ a: { get: {} } & { post: {} }; b: { put: {} } & { delete: {} } }`
		const result = flattenNestedIntersections(input)
		const parts = result.split('&').map((s) => s.trim())
		const unique = new Set(parts)
		expect(parts.length).toBe(unique.size)
	})

	it('declarationToJSONSchema deduplicates structurally identical candidates', () => {
		// Multi-route plugins can emit the same candidate body more than
		// once after distribution. Without dedup at the candidate level,
		// the per-route inline + TypeBox loop runs N times for the same
		// route, blowing up gen time. Verify that duplicates collapse to a
		// single result entry.
		const decl = `{ api: { foo: { get: {
			body: unknown;
			params: { properties: {} };
			query: { properties: {} };
			headers: { properties: {} };
			response: { 200: { ok: boolean } }
		} } } } & { api: { foo: { get: {
			body: unknown;
			params: { properties: {} };
			query: { properties: {} };
			headers: { properties: {} };
			response: { 200: { ok: boolean } }
		} } } }`
		const result = declarationToJSONSchema(decl)
		expect(result['/api/foo'].get).toBeDefined()
		// Only one path entry (no duplicates surfacing)
		expect(Object.keys(result)).toEqual(['/api/foo'])
	})

	it('terminates on adversarial deeply-nested intersection trees', () => {
		// Adversarial input where every leaf is unique. The function must
		// bound output growth and return promptly rather than running
		// until OOM. Real apps stabilize quickly; this exercises the cap.
		let input = `{ get: {} } & { post: {} }`
		for (let i = 0; i < 4; i++) {
			input = `{ a${i}: ${input} } & { b${i}: ${input} }`
		}
		const start = Date.now()
		const result = flattenNestedIntersections(input)
		expect(Date.now() - start).toBeLessThan(3000)
		expect(typeof result).toBe('string')
		expect(result.length).toBeGreaterThan(0)
	})
})

describe('Gen > transformWebApiGlobals', () => {
	it('replaces $ref: "Response" with an opaque schema', () => {
		expect(transformWebApiGlobals({ $ref: 'Response' })).toEqual({})
	})

	it('replaces $ref: "File" with binary string', () => {
		expect(transformWebApiGlobals({ $ref: 'File' })).toEqual({
			type: 'string',
			format: 'binary'
		})
	})

	it('replaces $ref: "Blob" with binary string', () => {
		expect(transformWebApiGlobals({ $ref: 'Blob' })).toEqual({
			type: 'string',
			format: 'binary'
		})
	})

	it('walks into properties', () => {
		const input = {
			type: 'object',
			properties: {
				file: { $ref: 'File' },
				name: { type: 'string' }
			}
		}
		expect(transformWebApiGlobals(input)).toEqual({
			type: 'object',
			properties: {
				file: { type: 'string', format: 'binary' },
				name: { type: 'string' }
			}
		})
	})

	it('walks into anyOf union members', () => {
		const input = {
			anyOf: [{ type: 'string' }, { $ref: 'Response' }]
		}
		expect(transformWebApiGlobals(input)).toEqual({
			anyOf: [{ type: 'string' }, {}]
		})
	})

	it('leaves unrelated $refs alone', () => {
		const input = { $ref: 'MyUserType' }
		expect(transformWebApiGlobals(input)).toEqual({ $ref: 'MyUserType' })
	})

	it('walks into items', () => {
		const input = { type: 'array', items: { $ref: 'File' } }
		expect(transformWebApiGlobals(input)).toEqual({
			type: 'array',
			items: { type: 'string', format: 'binary' }
		})
	})
})

describe('Gen > fromTypes tsconfig pins rootDir to prevent .d.ts leak', () => {
	// The leak regression (tsc spraying .d.ts across user src) happens when
	// the emitted tsconfig doesn't pin rootDir / leaves incremental on, so
	// tsc falls back to emitting declarations next to source files. This is
	// a structural test: verify the fromTypes source actually contains the
	// fix so it can't silently regress.
	it('source emits rootDir, composite:false, incremental:false in the tsconfig template', async () => {
		const fs = await import('node:fs')
		const src = fs.readFileSync('src/gen/index.ts', 'utf8')

		// Only check the default-compilerOptions branch (the one that writes
		// the hardcoded template). User-provided compilerOptions take over.
		expect(src).toContain('"rootDir": "${projectRoot}"')
		expect(src).toContain('"composite": false')
		expect(src).toContain('"incremental": false')
	})
})
