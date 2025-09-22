export type Stream = "food" | "drinks";

export type MenuItem = {
  id: number | string;
  name: string;
  description?: string | null;
  price: number;
  stream: Stream;        // <— important for later order-splitting
  image_url?: string | null;
  notes?: string | null; 
};
