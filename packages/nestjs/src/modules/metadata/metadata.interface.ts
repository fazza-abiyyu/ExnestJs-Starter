// OData entity type metadata definitions

export interface MetadataProperty {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string;
}

export interface MetadataEntityType {
  name: string;
  fragment: string;
  description?: string;
  properties: MetadataProperty[];
}

export interface MetadataResponse {
  entityTypes: MetadataEntityType[];
}
