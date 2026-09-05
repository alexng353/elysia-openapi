const assert = require('node:assert/strict')
const { join } = require('node:path')
const { runInNewContext } = require('node:vm')
const { buildSync } = require(
	require.resolve('esbuild', { paths: [require.resolve('tsup')] })
)

module.exports = function verifyBrowser() {
	const bundle = (contents) =>
		buildSync({
			stdin: {
				contents,
				resolveDir: join(__dirname, 'esm'),
				sourcefile: 'browser-smoke.js'
			},
			bundle: true,
			platform: 'browser',
			format: 'iife',
			write: false,
			metafile: true,
			external: ['elysia'],
			logLevel: 'error'
		})

	const runtime = bundle(`import { openapi } from '@elysiajs/openapi'
globalThis.openapi = openapi`)
	const inputs = Object.values(runtime.metafile.outputs).flatMap((output) =>
		Object.entries(output.inputs)
	)
	assert.ok(
		inputs.every(
			([name, input]) =>
				!name.includes('typescript/lib/') || input.bytesInOutput === 0
		),
		'Bundling the runtime plugin must not include the TypeScript compiler'
	)

	const generator = bundle(`import { fromTypes } from '@elysiajs/openapi/gen'
globalThis.references = fromTypes(
	'{ message: { get: { params: {}; query: unknown; headers: unknown; body: unknown; response: { 200: { message: string; createdAt: Date } } } } }'
)()`)
	const context = { console }
	runInNewContext(generator.outputFiles[0].text, context)
	const response = context.references?.['/message']?.get?.response?.[200]
	assert.equal(response?.properties.message.type, 'string')
	assert.equal(response?.properties.createdAt.type, 'string')
	assert.equal(response?.properties.createdAt.format, 'date-time')
}
