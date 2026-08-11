import type { AdditionalReference } from '../types';
export interface OpenAPIGeneratorOptions {
    /**
     * Path to tsconfig.json
     * @default tsconfig.json
     */
    tsconfigPath?: string;
    /**
     * Name of the Elysia instance
     *
     * If multiple instances are found,
     * instanceName should be provided
     */
    instanceName?: string;
    /**
     * Project root directory
     *
     * @default process.cwd()
     */
    projectRoot?: string;
    /**
     * Override output path
     *
     * Under any circumstance, that Elysia failed to find a correct schema,
     * Put your own schema in this path
     */
    overrideOutputPath?: string | ((tempDir: string) => string);
    /**
     * don't remove temporary files
     * for debugging purpose
     * @default false
     */
    debug?: boolean;
    /**
     * compilerOptions
     *
     * Override tsconfig.json compilerOptions
     */
    compilerOptions?: Record<string, any>;
    /**
     * Temporary root
     *
     * a folder where temporary files are stored
     * @default os.tmpdir()/.ElysiaAutoOpenAPI
     *
     * ! be careful that the folder will be removed after the process ends
     */
    tmpRoot?: string;
    /**
     * disable log
     * @default false
     */
    silent?: boolean;
}
export declare function extractRootObjects(code: string): string[];
/**
 * Extract type alias definitions from a declaration string and return
 * a map of name -> body (e.g. `User` -> `{ id: string; name: string; }`)
 */
export declare function extractTypeAliases(declaration: string): Record<string, string>;
/**
 * Replace type references with their inlined definitions so that
 * TypeBox can produce concrete schemas instead of unresolvable $refs
 */
export declare function inlineTypeReferences(code: string, aliases: Record<string, string>): string;
/**
 * Scan a declaration for `import("...").TypeName` references,
 * use TypeScript's module resolution to find the source files,
 * and extract the type aliases from them.
 *
 * This allows TypeBox to produce concrete schemas for cross-module types
 * (e.g. Drizzle ORM types imported from another package).
 */
export declare function resolveImportedTypes(declaration: string, projectRoot: string, tsconfigPath: string, sourceFilePath: string, existingAliases: Record<string, string>, fs: {
    existsSync: (path: string) => boolean;
    readFileSync: (path: string, encoding: BufferEncoding) => string;
}): Record<string, string>;
/**
 * Flatten nested intersections so that each root object represents a single route.
 *
 * Multi-route Elysia plugins produce declarations like:
 *   { api: { v3: { a: {...} } & { b: {...} } } }
 *
 * This distributes the outer structure over the inner intersection:
 *   { api: { v3: { a: {...} } } } & { api: { v3: { b: {...} } } }
 *
 * This way `extractRootObjects` and TypeBox can process each route individually.
 */
export declare function flattenNestedIntersections(declaration: string): string;
export declare function declarationToJSONSchema(declaration: string, typeAliases?: Record<string, string>): AdditionalReference;
/**
 * Extract the Nth (0-indexed) top-level generic parameter from
 * a string that starts with `: Elysia<...>` or `Elysia<...>`.
 *
 * Tracks `<>`, `{}`, `[]`, `()` depth so that commas inside
 * nested generics or object literals are not counted as separators.
 */
export declare function extractGenericParam(instance: string, paramIndex: number): string | undefined;
/**
 * Auto generate OpenAPI schema from Elysia instance
 *
 * It's expected that this command should run in project root
 *
 * @experimental use at your own risk
 */
export declare const fromTypes: (
/**
 * Path to file where Elysia instance is
 *
 * The path must export an Elysia instance
 * or a literal TypeScript declaration
 */
targetFilePath?: string, { tsconfigPath, instanceName, projectRoot, overrideOutputPath, debug, compilerOptions, tmpRoot, silent }?: OpenAPIGeneratorOptions) => () => AdditionalReference | undefined;
