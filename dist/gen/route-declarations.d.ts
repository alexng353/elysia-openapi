type RouteDeclaration = {
    path: string[];
    method: string;
    type: string;
};
export declare function extractRouteDeclarations(declaration: string): RouteDeclaration[];
/** Split the route tree while keeping each method's request and response types intact. */
export declare function flattenNestedIntersections(declaration: string): string;
export declare function normalizeGeneratedSchema(schema: Record<string | symbol, any>, onUnresolved: (name: string) => void): void;
export declare function prepareTypeForParser(type: string, onUnresolved?: (name: string) => void): string;
export {};
