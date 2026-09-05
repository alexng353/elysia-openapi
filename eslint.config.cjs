const eslint = require('@eslint/js')
const globals = require('globals')
const tseslint = require('typescript-eslint')

module.exports = tseslint.config(
	{ ignores: ['dist/**', 'example/**', 'test/gen/fixtures/**'] },
	{
		...eslint.configs.recommended,
		languageOptions: { globals: globals.node }
	},
	{
		files: ['**/*.{ts,mts,cts}'],
		extends: [...tseslint.configs.recommended],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ ignoreRestSiblings: true }
			],
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'@typescript-eslint/no-wrapper-object-types': 'off'
		}
	}
)
