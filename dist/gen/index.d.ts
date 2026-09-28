import type { AdditionalReference } from '../types';
export { extractTypeAliases, inlineTypeReferences, resolveImportedTypes } from './type-references';
export { flattenNestedIntersections } from './route-declarations';
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
export declare function declarationToJSONSchema(declaration: string, typeAliases?: Record<string, string>, { silent }?: Pick<OpenAPIGeneratorOptions, 'silent'>): AdditionalReference;
/** Extract a generic argument without treating literal text or arrow tokens as delimiters. */
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
