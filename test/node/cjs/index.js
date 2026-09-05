if ('Bun' in globalThis) throw new Error('❌ Use Node.js to run this test!')

const { openapi, fromTypes } = require('@elysiajs/openapi')
const verifyFromTypes = require('../from-types.cjs')

if (typeof openapi !== 'function') throw new Error('❌ CommonJS Node.js failed')

verifyFromTypes(fromTypes)

console.log('✅ CommonJS Node.js works!')
