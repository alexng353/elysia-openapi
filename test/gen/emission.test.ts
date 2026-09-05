import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { fromTypes } from '../../src/gen'

const projects: string[] = []

const project = (files: Record<string, string>) => {
	const root = mkdtempSync(join(tmpdir(), 'elysia-openapi-emission-'))
	projects.push(root)
	symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'junction')
	for (const [file, content] of Object.entries(files)) {
		const path = join(root, file)
		mkdirSync(dirname(path), { recursive: true })
		writeFileSync(path, content)
	}
	return root
}

const app = `import { Elysia } from 'elysia'
export const app = new Elysia().get('/message', () => ({ message: 'hello' }))`

afterEach(() => {
	for (const root of projects.splice(0))
		rmSync(root, { recursive: true, force: true })
})

const expectMessage = (reference: ReturnType<ReturnType<typeof fromTypes>>) => {
	expect(reference?.['/message']?.get?.response?.[200]).toMatchObject({
		type: 'object',
		required: ['message'],
		properties: { message: { type: 'string' } }
	})
}

describe('Gen > declaration emission', () => {
	it('generates routes from an absolute source path', () => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true }
			}),
			'src/app.ts': app
		})
		expectMessage(
			fromTypes(join(root, 'src/app.ts'), {
				projectRoot: root,
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it('includes sibling package sources without forcing the application rootDir', () => {
		const root = project({
			'apps/api/tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true, noEmitOnError: true }
			}),
			'apps/api/src/app.ts': `import { Elysia } from 'elysia'
import { message } from '../../../shared/message'
export const app = new Elysia().get('/message', message)`,
			'shared/message.ts': `export const message = () => ({ message: 'hello' })`
		})
		expectMessage(
			fromTypes('src/app.ts', {
				projectRoot: join(root, 'apps/api'),
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it.each(['inherited', 'explicit'] as const)(
		'does not emit into source directories with an invalid %s rootDir',
		(kind) => {
			const root = project({
				'apps/api/tsconfig.json': JSON.stringify({
					compilerOptions: {
						strict: true,
						...(kind === 'inherited' ? { rootDir: '.' } : {})
					}
				}),
				'apps/api/src/app.ts': `import { Elysia } from 'elysia'
import { message } from '../../../shared/message'
export const app = new Elysia().get('/message', message)`,
				'shared/message.ts': `export const message = () => ({ message: 'hello' })`
			})
			expectMessage(
				fromTypes('src/app.ts', {
					projectRoot: join(root, 'apps/api'),
					tmpRoot: join(root, 'emit'),
					compilerOptions:
						kind === 'explicit'
							? { rootDir: join(root, 'apps/api') }
							: {},
					silent: true
				})()
			)
			expect(existsSync(join(root, 'shared/message.d.ts'))).toBe(false)
		}
	)

	it('resolves a custom nested tsconfig and its relative extends and paths', () => {
		const root = project({
			'tsconfig.base.json': JSON.stringify({
				compilerOptions: {
					strict: true,
					noEmit: true,
					noEmitOnError: true
				}
			}),
			'config/tsconfig.app.json': JSON.stringify({
				extends: '../tsconfig.base.json',
				compilerOptions: {
					baseUrl: '..',
					paths: { '@message': ['shared/message.ts'] }
				}
			}),
			'src/app.ts': `import { Elysia } from 'elysia'
import { message } from '@message'
export const app = new Elysia().get('/message', message)`,
			'shared/message.ts': `export const message = () => ({ message: 'hello' })`
		})
		expectMessage(
			fromTypes('src/app.ts', {
				projectRoot: root,
				tsconfigPath: 'config/tsconfig.app.json',
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it('resolves sibling package self-exports without an ambiguous project root', () => {
		const root = project({
			'apps/api/tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true, noEmitOnError: true }
			}),
			'apps/api/src/app.ts': `import { Elysia } from 'elysia'
import { message } from '../../../shared/src/index'
export const app = new Elysia().get('/message', message)`,
			'shared/package.json': JSON.stringify({
				name: '@workspace/shared',
				exports: { './message': './src/message.ts' }
			}),
			'shared/src/index.ts': `export { message } from '@workspace/shared/message'`,
			'shared/src/message.ts': `export const message = () => ({ message: 'hello' })`
		})
		expectMessage(
			fromTypes('src/app.ts', {
				projectRoot: join(root, 'apps/api'),
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it('honors rootDir and declarationDir from the project configuration', () => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: {
					strict: true,
					rootDir: 'src',
					declarationDir: 'types'
				}
			}),
			'src/app.ts': app
		})
		expectMessage(
			fromTypes('src/app.ts', {
				projectRoot: root,
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
		expect(existsSync(join(root, 'types/app.d.ts'))).toBe(true)
	})

	it('applies explicit compiler options on top of declaration defaults', () => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: { strictNullChecks: false, noEmit: true }
			}),
			'src/app.ts': `import { Elysia } from 'elysia'
export const app = new Elysia().get('/message', () => ({ message: null as string | null }))`
		})
		const reference = fromTypes('src/app.ts', {
			projectRoot: root,
			tmpRoot: join(root, 'emit'),
			compilerOptions: { strictNullChecks: true },
			silent: true
		})()
		expect(reference?.['/message']?.get?.response?.[200]).toMatchObject({
			type: 'object',
			properties: {
				message: { anyOf: [{ type: 'string' }, { type: 'null' }] }
			}
		})
	})

	it('uses compilerOptions paths when resolving emitted imported aliases', () => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true }
			}),
			'src/app.ts': `import { Elysia } from 'elysia'
import type { Payload } from '@models/payload'
export const app = new Elysia().get('/message', () => ({ payload: {} as Payload }))`,
			'shared/payload.ts': `export type Payload = { message: string }`
		})
		const reference = fromTypes('src/app.ts', {
			projectRoot: root,
			tmpRoot: join(root, 'emit'),
			compilerOptions: {
				baseUrl: root,
				paths: { '@models/*': ['shared/*'] }
			},
			silent: true
		})()
		expect(reference?.['/message']?.get?.response?.[200]).toMatchObject({
			properties: {
				payload: {
					type: 'object',
					properties: { message: { type: 'string' } }
				}
			}
		})
	})

	it('reads a relative declaration path from projectRoot', () => {
		const root = project({
			'src/app.d.ts': `import { Elysia } from 'elysia'
export declare const app: Elysia<"", {}, {}, {}, {
message: { get: { params: {}; query: unknown; headers: unknown; body: unknown;
response: { 200: { message: string } } } }
}>;`
		})
		expectMessage(
			fromTypes('src/app.d.ts', {
				projectRoot: root,
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it('finds an Elysia instance inferred from an imported factory', () => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true }
			}),
			'src/app.ts': `import { createApp } from './factory'
export const app = createApp()`,
			'src/factory.ts': `import { Elysia } from 'elysia'
export const createApp = () => new Elysia().get('/message', () => ({ message: 'hello' }))`
		})
		expectMessage(
			fromTypes('src/app.ts', {
				projectRoot: root,
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it('finds an Elysia instance imported through a namespace', () => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true }
			}),
			'src/app.ts': `import * as Server from 'elysia'
export const app = new Server.Elysia().get('/message', () => ({ message: 'hello' }))`
		})
		expectMessage(
			fromTypes('src/app.ts', {
				projectRoot: root,
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it('selects instanceName exactly when a file exports multiple applications', () => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true }
			}),
			'src/app.ts': `import { Elysia as Server } from 'elysia'
export const otherapp = new Server().get('/message', () => ({ message: 123 }))
export const app = new Server().get('/message', () => ({ message: 'hello' }))`
		})
		expectMessage(
			fromTypes('src/app.ts', {
				projectRoot: root,
				instanceName: 'app',
				tmpRoot: join(root, 'emit'),
				silent: true
			})()
		)
	})

	it.each([true, false])('honors noEmitOnError: %s', (noEmitOnError) => {
		const root = project({
			'tsconfig.json': JSON.stringify({
				compilerOptions: { strict: true, noEmitOnError }
			}),
			'src/app.ts': `${app}\nconst invalid: number = 'not a number'`
		})
		const warn = spyOn(console, 'warn').mockImplementation(() => {})
		try {
			const reference = fromTypes('src/app.ts', {
				projectRoot: root,
				tmpRoot: join(root, 'emit'),
				debug: true,
				silent: true
			})()
			if (noEmitOnError) {
				expect(reference).toBeUndefined()
				expect(warn).toHaveBeenCalledWith(
					expect.stringContaining('TS2322')
				)
				expect(existsSync(join(root, 'emit/tsconfig.json'))).toBe(true)
			} else expectMessage(reference)
		} finally {
			warn.mockRestore()
		}
	})

	it.each(['relative', 'absolute', 'callback'] as const)(
		'uses a %s overrideOutputPath',
		(kind) => {
			const root = project({
				'tsconfig.json': JSON.stringify({
					compilerOptions: { strict: true }
				}),
				'src/app.ts': `import './other'\n${app.replace("'hello'", '123')}`,
				'src/other.ts': app
			})
			expectMessage(
				fromTypes('src/app.ts', {
					projectRoot: root,
					tmpRoot: join(root, 'emit'),
					silent: true,
					overrideOutputPath:
						kind === 'relative'
							? 'other.d.ts'
							: kind === 'absolute'
								? join(root, 'emit/dist/other.d.ts')
								: (tmpRoot) => join(tmpRoot, 'dist/other.d.ts')
				})()
			)
		}
	)
})
