// VA-ORM Schema Mapping
//
// Resolves database table/column names from @map/@@map attributes,
// falling back to model tableName or snake_case.
export function toSnakeCase(name) {
    return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
export function tableNameOf(model) {
    if (model.tableName)
        return model.tableName;
    const mapAttr = model.attributes.find((a) => a.name === '@@map');
    if (mapAttr) {
        const mapped = firstPositionalArg(mapAttr.args);
        if (mapped !== undefined)
            return mapped;
    }
    return toSnakeCase(model.name);
}
export function columnNameOfField(field) {
    return field.columnName || field.name;
}
export function columnNameOf(model, fieldName) {
    const field = model.fields.find((f) => f.name === fieldName);
    if (!field)
        return fieldName;
    return columnNameOfField(field);
}
function firstPositionalArg(args) {
    if (typeof args.value === 'string')
        return stripArgQuotes(args.value);
    for (const [key, value] of Object.entries(args)) {
        if (value === true)
            return stripArgQuotes(key);
    }
    return undefined;
}
function stripArgQuotes(value) {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
    }
    return value;
}
//# sourceMappingURL=schema.mapping.js.map