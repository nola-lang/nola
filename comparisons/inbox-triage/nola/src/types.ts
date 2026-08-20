export interface Customer {
  name: string;
  company?: string;
}

export interface Address {
  street: string;
  city: string;
  zip: string;
}

export interface LineItem {
  description: string;
  quantity: number;
}

export interface OrderRequest {
  customer: Customer;
  shipTo: Address;
  items: LineItem[];
  /** requested delivery date, if the email names one */
  needBy?: Date;
  priority: "standard" | "rush";
}
