import { Elysia } from 'elysia';
import type { ElysiaOpenAPIConfig } from './types';
/**
 * Plugin for [elysia](https://github.com/elysiajs/elysia) that auto-generate OpenAPI documentation page.
 *
 * @see https://github.com/elysiajs/elysia-swagger
 */
export declare const openapi: <const Enabled extends boolean = true, const Path extends string = "/openapi">({ enabled, path, provider, specPath, documentation, exclude, swagger, scalar, references, mapJsonSchema, embedSpec }?: ElysiaOpenAPIConfig<Enabled, Path>) => Elysia<"", {
    decorator: {};
    store: {};
    derive: {};
    resolve: {};
}, {
    typebox: {};
    error: {};
}, {
    schema: {};
    standaloneSchema: {};
    macro: {};
    macroFn: {};
    parser: {};
    response: {};
}, {}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}, {
    derive: {};
    resolve: {};
    schema: {};
    standaloneSchema: {};
    response: {};
}>;
export { fromTypes } from './gen';
export { toOpenAPISchema, withHeaders } from './openapi';
export type { ElysiaOpenAPIConfig };
export default openapi;
