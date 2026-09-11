export interface SchemaAST {
    generator: GeneratorBlock[];
    datasource: DatasourceBlock[];
    model: ModelBlock[];
    enum: EnumBlock[];
    view?: ViewBlock[];
}
export interface GeneratorBlock {
    name: string;
    provider: string;
    output?: string;
    binaryTargets?: string[];
}
export interface DatasourceBlock {
    name: string;
    provider: string;
    url: string;
}
export interface ModelBlock {
    name: string;
    tableName?: string;
    fields: FieldDefinition[];
    attributes: ModelAttribute[];
    isIgnored?: boolean;
}
export interface FieldDefinition {
    name: string;
    type: string;
    isArray: boolean;
    isOptional: boolean;
    attributes: FieldAttribute[];
    columnName?: string;
    isIgnored?: boolean;
}
export interface FieldAttribute {
    name: string;
    args: Record<string, any>;
}
export interface ModelAttribute {
    name: string;
    args: Record<string, any>;
}
export interface EnumBlock {
    name: string;
    values: EnumValue[];
}
export interface EnumValue {
    name: string;
    attributes?: FieldAttribute[];
}
export interface ViewBlock {
    name: string;
    tableName?: string;
    fields: ViewField[];
    query?: string;
    attributes: ModelAttribute[];
}
export interface ViewField {
    name: string;
    type: string;
    isOptional: boolean;
}
export type RelationKind = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many-implicit';
export type ReferentialAction = 'Cascade' | 'Restrict' | 'NoAction' | 'SetNull' | 'SetDefault';
export interface RelationFieldInfo {
    field: string;
    targetModel: string;
    isList: boolean;
    kind: RelationKind;
    fkModel: string;
    fkFields: string[];
    pkModel: string;
    pkFields: string[];
    onDelete?: string;
    relationName?: string;
    joinTable?: string;
    backField?: string;
    isFkHolder: boolean;
}
export interface ValidationError {
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning' | 'info';
}
export interface ValidationWarning {
    line: number;
    column: number;
    message: string;
}
export interface SchemaInfo {
    models: ModelInfo[];
    enums: EnumInfo[];
    generator: GeneratorInfo;
    datasource: DatasourceInfo;
}
export interface ModelInfo {
    name: string;
    tableName: string;
    fields: FieldInfo[];
    primaryKey?: string;
    indexes: IndexInfo[];
}
export interface FieldInfo {
    name: string;
    type: string;
    isOptional: boolean;
    isArray: boolean;
    isId: boolean;
    isUnique: boolean;
    hasDefault: boolean;
    defaultValue?: any;
    references?: ReferenceInfo;
}
export interface ReferenceInfo {
    model: string;
    field: string;
    onDelete?: string;
}
export interface IndexInfo {
    fields: string[];
    isUnique: boolean;
}
export interface EnumInfo {
    name: string;
    values: string[];
}
export interface GeneratorInfo {
    provider: string;
    output: string;
}
export interface DatasourceInfo {
    provider: string;
    url: string;
}
//# sourceMappingURL=schema.types.d.ts.map