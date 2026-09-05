import { describe, expect, it } from 'bun:test'
import { Elysia, t } from 'elysia'

import { openapi } from '../src'
import type { AdditionalReference } from '../src/types'

const req = (path: string) => new Request(`http://localhost${path}`)

describe('OpenAPI > multiple instances', () => {
	it('serves separate documentation pages and filtered specifications', async () => {
		const app = new Elysia()
			.use(
				openapi({
					path: '/public',
					exclude: {
						routes: ({ hooks }) =>
							!hooks.detail?.tags?.includes('public')
					},
					documentation: {
						info: { title: 'Public API', version: '1.0.0' }
					}
				})
			)
			.use(
				openapi({
					path: '/internal',
					provider: 'swagger-ui',
					documentation: {
						info: { title: 'Internal API', version: '1.0.0' }
					}
				})
			)
			.get('/users', 'ok', { detail: { tags: ['public'] } })
			.get('/admin', 'ok')

		const publicDocument = await app
			.handle(req('/public/json'))
			.then((res) => res.json())
		const internalDocument = await app
			.handle(req('/internal/json'))
			.then((res) => res.json())
		expect(publicDocument.info.title).toBe('Public API')
		expect(Object.keys(publicDocument.paths)).toEqual(['/users'])
		expect(internalDocument.info.title).toBe('Internal API')
		expect(Object.keys(internalDocument.paths)).toEqual([
			'/users',
			'/admin'
		])
		expect(
			await app.handle(req('/public')).then((res) => res.text())
		).toContain('<title>Public API</title>')
		expect(
			await app.handle(req('/internal')).then((res) => res.text())
		).toContain('<title>Internal API</title>')
	})

	it('supports distinct specification paths without changing the unused UI path', async () => {
		const app = new Elysia()
			.use(
				openapi({
					provider: null,
					specPath: '/public.json',
					openapiVersion: '3.0.3'
				})
			)
			.use(
				openapi({
					provider: null,
					specPath: '/internal.json',
					openapiVersion: '3.1.2'
				})
			)
			.get('/nullable', () => null, { response: t.Nullable(t.String()) })

		const publicDocument = await app
			.handle(req('/public.json'))
			.then((res) => res.json())
		const internalDocument = await app
			.handle(req('/internal.json'))
			.then((res) => res.json())
		expect(publicDocument.openapi).toBe('3.0.3')
		expect(internalDocument.openapi).toBe('3.1.2')
		expect(
			publicDocument.paths['/nullable'].get.responses['200'].content[
				'text/plain'
			].schema
		).toMatchObject({ type: 'string', nullable: true })
		expect(
			internalDocument.paths['/nullable'].get.responses['200'].content[
				'application/json'
			].schema
		).toMatchObject({ type: ['string', 'null'] })
		expect((await app.handle(req('/openapi'))).status).toBe(404)
	})

	it('does not suppress an enabled instance after a disabled instance', async () => {
		const app = new Elysia()
			.use(openapi({ enabled: false }))
			.use(openapi())
			.get('/', 'ok')
		expect((await app.handle(req('/openapi'))).status).toBe(200)
		const document = await app
			.handle(req('/openapi/json'))
			.then((res) => res.json())
		expect(Object.keys(document.paths)).toEqual(['/'])
	})

	it.each([false, true])(
		'keeps each specification reference independent (reverse order: %s)',
		async (reverse) => {
			const reference = (value: string): AdditionalReference => ({
				'/users': {
					get: {
						params: t.Object({}),
						query: t.Object({ audience: t.Literal(value) }),
						headers: t.Object({}),
						body: t.Object({}),
						response: { 201: t.Literal(value) }
					}
				}
			})
			const app = new Elysia()
				.use(
					openapi({
						provider: null,
						specPath: '/one.json',
						references: reference('one')
					})
				)
				.use(
					openapi({
						provider: null,
						specPath: '/two.json',
						references: reference('two')
					})
				)
				.get('/users', () => 'ok', { response: { 200: t.String() } })
			const order = reverse ? ['two', 'one'] : ['one', 'two']
			for (const name of order) {
				const document = await app
					.handle(req(`/${name}.json`))
					.then((res) => res.json())
				expect(
					document.paths['/users'].get.responses['201'].content[
						'text/plain'
					].schema
				).toMatchObject({ const: name })
				expect(document.paths['/users'].get.parameters).toContainEqual({
					name: 'audience',
					in: 'query',
					required: true,
					schema: { type: 'string', const: name }
				})
			}
			expect((await app.handle(req('/users'))).status).toBe(200)
		}
	)

	it('filters embedded specifications independently', async () => {
		const app = new Elysia()
			.use(
				openapi({
					path: '/public',
					embedSpec: true,
					exclude: { routes: ({ path }) => path === '/admin' }
				})
			)
			.use(openapi({ path: '/internal', embedSpec: true }))
			.get('/users', 'ok')
			.get('/admin', 'ok')

		for (const path of ['/public', '/internal']) {
			const page = await app.handle(req(path)).then((res) => res.text())
			const configuration = JSON.parse(
				page.match(/data-configuration='([^']+)'/)![1]
			)
			const document = JSON.parse(configuration.content)
			expect(Object.keys(document.paths)).toEqual(
				path === '/public' ? ['/users'] : ['/users', '/admin']
			)
		}
	})
})
