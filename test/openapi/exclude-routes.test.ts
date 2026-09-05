import { describe, expect, it, mock } from 'bun:test'
import { Elysia, t, type AnyElysia } from 'elysia'

import { openapi, toOpenAPISchema } from '../../src'
import type { ElysiaOpenAPIConfig } from '../../src'

describe('OpenAPI > exclude.routes', () => {
	it('filters routes using their method, original path and inherited detail', async () => {
		const visited: string[] = []
		const app = new Elysia()
			.use(
				openapi({
					exclude: {
						routes: ({ method, path, hooks }) => {
							visited.push(`${method} ${path}`)
							return (
								method !== 'GET' ||
								!hooks.detail?.tags?.includes('public')
							)
						}
					}
				})
			)
			.use(
				new Elysia({ prefix: '/api' })
					.guard({ detail: { tags: ['public'] } })
					.get('/users/:id?', () => 'ok')
					.post('/users', () => 'ok')
			)
			.get('/internal', () => 'ok')

		const response = await app.handle(
			new Request('http://localhost/openapi/json')
		)
		expect(response.status).toBe(200)
		const document = await response.json()
		expect(Object.keys(document.paths).sort()).toEqual([
			'/api/users',
			'/api/users/{id}'
		])
		expect(visited).toEqual([
			'GET /api/users/:id?',
			'POST /api/users',
			'GET /internal'
		])
	})

	it.each(['3.0.3', '3.1.2'] as const)(
		'preserves existing exclusions for %s',
		(version) => {
			const app = new Elysia()
				.get('/visible', () => 'ok')
				.get('/hidden', () => 'ok', { detail: { hide: true } })
				.get('/asset.js', () => 'ok')
				.options('/preflight', () => 'ok')
				.get('/path', () => 'ok')
				.get('/tag', () => 'ok', { detail: { tags: ['internal'] } })

			const document = toOpenAPISchema(
				app,
				{
					paths: '/path',
					tags: ['internal'],
					routes: () => false
				},
				undefined,
				undefined,
				version
			)
			expect(Object.keys(document.paths)).toEqual(['/visible'])
		}
	)

	it('preserves static file and method opt-ins', () => {
		const app = new Elysia()
			.get('/asset.js', () => 'ok')
			.options('/preflight', () => 'ok')
		const document = toOpenAPISchema(app, {
			staticFile: false,
			methods: [],
			routes: () => false
		})
		expect(Object.keys(document.paths)).toEqual(['/asset.js', '/preflight'])
	})

	it('calls the predicate once before expanding an ALL route', () => {
		const app = new Elysia().all('/all', () => 'ok')
		const routes = mock(
			({ method }: { method: string }) => method === 'ALL'
		)
		expect(toOpenAPISchema(app, { routes }).paths).toEqual({})
		expect(routes).toHaveBeenCalledTimes(1)
	})
})

describe('OpenAPI > deferred references', () => {
	const cases: [string, () => AnyElysia, ElysiaOpenAPIConfig['exclude']][] = [
		['no routes', () => new Elysia(), undefined],
		[
			'hidden routes',
			() => new Elysia().get('/', 'ok', { detail: { hide: true } }),
			undefined
		],
		['excluded paths', () => new Elysia().get('/', 'ok'), { paths: '/' }],
		[
			'excluded methods',
			() => new Elysia().get('/', 'ok'),
			{ methods: ['GET'] }
		],
		['static files', () => new Elysia().get('/asset.js', 'ok'), undefined],
		[
			'excluded tags',
			() =>
				new Elysia().get('/', 'ok', { detail: { tags: ['internal'] } }),
			{ tags: ['internal'] }
		],
		[
			'excluded routes',
			() => new Elysia().get('/', 'ok'),
			{ routes: () => true }
		]
	]

	it.each(cases)(
		'does not resolve references with %s',
		(_, createApp, exclude) => {
			const references = mock(() => {
				throw new Error('References should not be evaluated')
			})
			const document = toOpenAPISchema(createApp(), exclude, references)
			expect(document.paths).toEqual({})
			expect(references).not.toHaveBeenCalled()
		}
	)

	it('retains model definitions without included routes', () => {
		const app = new Elysia().model('User', t.Object({ name: t.String() }))
		const document = toOpenAPISchema(app, undefined, () => {
			throw new Error('References should not be evaluated')
		})
		expect(document.components.schemas.User).toMatchObject({
			type: 'object'
		})
	})

	it('resolves reference functions once per generation when routes remain', () => {
		const app = new Elysia().get('/one', 'ok').get('/two', 'ok')
		const references = mock(() => ({}))
		expect(
			Object.keys(toOpenAPISchema(app, undefined, references).paths)
		).toEqual(['/one', '/two'])
		expect(references).toHaveBeenCalledTimes(1)
	})
})
