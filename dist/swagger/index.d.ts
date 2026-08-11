import { OpenAPIV3 } from 'openapi-types';
import { ElysiaOpenAPIConfig } from '../types';
import { SwaggerUIOptions } from './types';
type SchemaObject = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
export declare function transformDateProperties(schema: SchemaObject): SchemaObject;
export declare const SwaggerUIRender: (info: OpenAPIV3.InfoObject, config: NonNullable<ElysiaOpenAPIConfig["swagger"]> & SwaggerUIOptions) => string;
export {};
