let compiler

exports.getTypeScript = function getTypeScript() {
	return (compiler ??= require('typescript'))
}
