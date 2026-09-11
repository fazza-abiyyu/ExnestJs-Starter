import type { ModelBlock, RelationFieldInfo } from './schema.types.js';
export declare function resolveRelations(models: ModelBlock[], tableNames?: Map<string, string>): Map<string, RelationFieldInfo>;
export declare function implicitJoinTable(a: string, b: string): string;
export declare function isScalarType(type: string, enumNames?: Set<string>): boolean;
//# sourceMappingURL=schema.relations.d.ts.map