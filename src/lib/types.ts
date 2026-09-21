export type Locale = "ar" | "en";
export type Confidence = "high" | "low";

export interface Product {
  id: string;
  name: string;
  nameAr: string;
  aliases: string[];
  batchSize?: number;
  packaging: { name: string; qtyPerUnit: number }[];
}

export interface OrderItem {
  productId?: string;
  rawText: string;
  quantity: number;
}

export type OrderStatus = "confirmed" | "prepped" | "collected";

export interface Order {
  id: string;
  customerName: string;
  items: OrderItem[];
  collectionAt?: string;
  notes?: string;
  status: OrderStatus;
  changes: string[];
  createdAt: string;
}

export interface DraftItem {
  productId?: string;
  rawText: string;
  quantity?: number;
  confidence: Confidence;
}

export interface Draft {
  customerName?: string;
  customerConfidence: Confidence;
  items: DraftItem[];
  collectionAt?: string;
  collectionConfidence: Confidence;
  notes?: string;
  oldQuantities: number[];
}
