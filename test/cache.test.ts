import { describe, expect, it } from 'bun:test'
import { Elysia, type AnyElysia, t } from 'elysia'

import { openapi } from '../src'

const documentAt = async (app: AnyElysia, path: string) => {
	const response = await app.handle(new Request(`http://localhost${path}`))
	expect(response.status).toBe(200)
	if (path.endsWith('/json')) return response.json()

	const page = await response.text()
	const configuration = JSON.parse(
		page.match(/data-configuration='([^']+)'/)![1]
	)
	return JSON.parse(configuration.content)
}

describe('OpenAPI > cache', () => {
	it.each(['/openapi', '/openapi/json'])(
		'reuses references across embedded and JSON requests starting with %s',
		async (firstPath) => {
			let calls = 0
			const app = new Elysia()
				.use(
					openapi({
						embedSpec: true,
						references: [
							() => {
								calls++
								return {
									'/users': {
										get: {
											params: t.Object({}),
											query: t.Object({}),
											headers: t.Object({}),
											body: t.Object({}),
											response: { 200: t.Literal(calls) }
										}
									}
								}
							}
						]
					})
				)
				.get('/users', () => 1)

			for (const path of [firstPath, '/openapi', '/openapi/json']) {
				const document = await documentAt(app, path)
				expect(
					document.paths['/users'].get.responses['200'].content[
						'text/plain'
					].schema
				).toMatchObject({ const: 1 })
			}
			expect(calls).toBe(1)
		}
	)

	it.each(['/openapi', '/openapi/json'])(
		'invalidates cached documents when parent routes are added after %s',
		async (firstPath) => {
			const app = new Elysia()
				.use(openapi({ embedSpec: true }))
				.get('/users', 'ok')

			const initial = await documentAt(app, firstPath)
			expect(Object.keys(initial.paths)).toEqual(['/users'])

			app.get('/added', 'ok').compile()
			for (const path of ['/openapi/json', '/openapi']) {
				const document = await documentAt(app, path)
				expect(Object.keys(document.paths)).toEqual([
					'/users',
					'/added'
				])
			}
		}
	)
})
