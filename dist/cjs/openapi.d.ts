import { type AnyElysia, type TSchema, type InputSchema } from 'elysia';
import type { OpenAPIV3 } from 'openapi-types';
import { TAnySchema, type TProperties } from '@sinclair/typebox';
import type { AdditionalReferences, ElysiaOpenAPIConfig, MapJsonSchema } from './types';
export declare const capitalize: (word: string) => string;
/**
 * Get all possible paths of a path with optional parameters
 * @param {string} path
 * @returns {string[]} paths
 */
export declare const getPossiblePath: (path: string) => string[];
export declare const getLoosePath: (path: string) => string;
export declare const unwrapSchema: (schema: InputSchema["body"], mapJsonSchema?: MapJsonSchema, io?: "input" | "output") => OpenAPIV3.SchemaObject | undefined;
/**
 * Convert TypeBox enum-like Union schemas to OpenAPI enum schemas
 *
 * Otherwise, return the schema as is
 */
export declare const enumToOpenApi: <T extends TAnySchema | OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined>(_schema: T) => T;
/**
 * Converts Elysia routes to OpenAPI 3.0.3 paths schema
 * @param routes Array of Elysia route objects
 * @returns OpenAPI paths object
 */
export declare function toOpenAPISchema(app: AnyElysia, exclude?: ElysiaOpenAPIConfig['exclude'], references?: AdditionalReferences, vendors?: MapJsonSchema): {
    components: {
        schemas: any;
    };
    paths: OpenAPIV3.PathsObject<{}, {}>;
};
export declare const withHeaders: (schema: TSchema, headers: TProperties) => TSchema & {
    headers: TProperties;
};
