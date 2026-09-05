import { describe, expect, it } from 'bun:test'
import { Elysia, t } from 'elysia'
import SwaggerParser from '@apidevtools/swagger-parser'

import { toOpenAPISchema, withHeaders } from '../../src/openapi'

describe('OpenAPI > empty responses', () => {
	for (const openapiVersion of ['3.0.3', '3.1.2'] as const) {
		it.each([
			['void', t.Void()],
			['undefined', t.Undefined()]
		] as const)(
			`omits response content for %s and preserves headers in ${openapiVersion}`,
			async (_, schema) => {
				const app = new Elysia().get('/empty', () => {}, {
					response: {
						200: schema,
						204: withHeaders(
							{ ...schema, description: 'No content' },
							{ 'x-request-id': t.String() }
						)
					}
				})
				const document = {
					openapi: openapiVersion,
					info: { title: 'Empty responses', version: '1.0.0' },
					...toOpenAPISchema(
						app,
						undefined,
						undefined,
						undefined,
						openapiVersion
					)
				}
				const responses = JSON.parse(
					JSON.stringify(document.paths['/empty']!.get!.responses!)
				)
				expect(responses['200']).toEqual({
					description: 'Response for status 200'
				})
				expect(responses['204']).toEqual({
					description: 'No content',
					headers: { 'x-request-id': { schema: { type: 'string' } } }
				})
				await SwaggerParser.validate(document)
			}
		)
	}
})
