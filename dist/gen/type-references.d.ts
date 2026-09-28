import type ts from 'typescript';
type Filesystem = {
    existsSync: (path: string) => boolean;
    readFileSync: (path: string, encoding: BufferEncoding) => string;
};
/** Extract complete alias bodies, enum values, and readonly tuple element types. */
export declare function extractTypeAliases(declaration: string): Record<string, string>;
/** Inline type nodes only, retaining property names, literals, and operator precedence. */
export declare function inlineTypeReferences(code: string, aliases: Record<string, string>, onUnresolved?: (name: string) => void): string;
/** Resolve imported symbols once and keep their dependencies scoped to their module. */
export declare function resolveImportedTypes(declaration: string, projectRoot: string, tsconfigPath: string, sourceFilePath: string, existingAliases: Record<string, string>, fs: Filesystem, resolvedCompilerOptions?: ts.CompilerOptions): Record<string, string>;
export {};
