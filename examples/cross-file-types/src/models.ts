export interface Address {
  city: string;
  zip: string;
}

export interface Person {
  name: string;
  /** reporting line, if any */
  manager?: Person;
  home: Address;
}
