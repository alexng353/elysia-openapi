const assert = require('node:assert/strict')
const {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')

module.exports = function verifyFromTypes(fromTypes) {
	assert.equal(
		require.cache[require.resolve('typescript')],
		undefined,
		'Importing the plugin must not load the TypeScript compiler'
	)
	const root = mkdtempSync(join(tmpdir(), 'elysia-openapi-node-'))
	try {
		mkdirSync(join(root, 'node_modules'))
		symlinkSync(
			dirname(require.resolve('elysia/package.json')),
			join(root, 'node_modules/elysia'),
			'junction'
		)
		writeFileSync(
			join(root, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: { strict: true, noEmitOnError: true }
			})
		)
		writeFileSync(
			join(root, 'message.ts'),
			`export type Message = {
	message: string;
	count: number;
	status: "ready" | "done";
	createdAt: Date;
}`
		)
		writeFileSync(
			join(root, 'app.ts'),
			`import { Elysia } from 'elysia'
import type { Message } from './message'
export const app = new Elysia().get('/message', (): Message => ({
	message: 'hello', count: 1, status: 'ready', createdAt: new Date()
}))`
		)

		const references = fromTypes('app.ts', {
			projectRoot: root,
			tmpRoot: join(root, 'emit'),
			silent: true
		})()
		assert.ok(
			references,
			'fromTypes must generate source references under Node.js'
		)
		const response = references['/message']?.get?.response?.[200]
		assert.equal(response?.type, 'object')
		assert.deepEqual([...response.required].sort(), [
			'count',
			'createdAt',
			'message',
			'status'
		])
		assert.equal(response.properties.message.type, 'string')
		assert.equal(response.properties.count.type, 'number')
		assert.equal(response.properties.createdAt.type, 'string')
		assert.equal(response.properties.createdAt.format, 'date-time')
		assert.deepEqual(
			response.properties.status.anyOf
				.map((schema) => schema.const)
				.sort(),
			['done', 'ready']
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}
