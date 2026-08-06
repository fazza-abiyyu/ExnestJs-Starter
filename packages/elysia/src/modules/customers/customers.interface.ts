export interface CustomerData {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerResponse {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
