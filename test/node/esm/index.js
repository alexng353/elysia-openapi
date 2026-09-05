if ('Bun' in globalThis) throw new Error('❌ Use Node.js to run this test!')

import { openapi, fromTypes } from '@elysiajs/openapi'
import verifyFromTypes from '../from-types.cjs'
import verifyBrowser from '../browser.cjs'

if (typeof openapi !== 'function') throw new Error('❌ ESM Node.js failed')

verifyFromTypes(fromTypes)
verifyBrowser()

console.log('✅ ESM Node.js works!')
