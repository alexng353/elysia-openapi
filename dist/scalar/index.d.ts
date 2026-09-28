import type { OpenAPIV3 } from 'openapi-types';
import { ElysiaOpenAPIConfig } from '../types';
export declare const ScalarRender: (info: OpenAPIV3.InfoObject, config: NonNullable<ElysiaOpenAPIConfig["scalar"]>, embedSpec?: string) => string;
