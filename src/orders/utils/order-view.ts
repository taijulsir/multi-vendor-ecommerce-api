import type {
  MasterOrder,
  OrderItem,
  Prisma,
  VendorOrder,
} from '../../generated/prisma/client';

export interface OrderItemView {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  attributes: Prisma.JsonValue;
  unitPrice: string;
  quantity: number;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
}

/**
 * `commissionAmount` and `vendorNetAmount` are deliberately excluded —
 * they are the platform's and vendor's internal financial split, not
 * customer-relevant, mirroring this codebase's existing "explicit
 * allowlist" pattern for response shaping (`toSafeUser`, `toPublicShop`,
 * `toPublicProduct`). Not stated verbatim in the docs; see this phase's
 * final report.
 */
export interface VendorOrderView {
  id: string;
  vendorId: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  totalAmount: string;
  items: OrderItemView[];
}

export interface MasterOrderView {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  discountAmount: string;
  shippingAmount: string;
  taxAmount: string;
  serviceFee: string;
  totalAmount: string;
  paymentStatus: string;
  shippingAddressSnapshot: Prisma.JsonValue;
  billingAddressSnapshot: Prisma.JsonValue;
  customerNote: string | null;
  placedAt: Date | null;
  createdAt: Date;
  vendorOrders: VendorOrderView[];
}

function toOrderItemView(item: OrderItem): OrderItemView {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    attributes: item.attributes,
    unitPrice: item.unitPrice.toFixed(2),
    quantity: item.quantity,
    discountAmount: item.discountAmount.toFixed(2),
    taxAmount: item.taxAmount.toFixed(2),
    totalAmount: item.totalAmount.toFixed(2),
    currency: item.currency,
  };
}

function toVendorOrderView(
  vendorOrder: VendorOrder & { items: OrderItem[] },
): VendorOrderView {
  return {
    id: vendorOrder.id,
    vendorId: vendorOrder.vendorId,
    orderNumber: vendorOrder.orderNumber,
    status: vendorOrder.status,
    subtotal: vendorOrder.subtotal.toFixed(2),
    discountAmount: vendorOrder.discountAmount.toFixed(2),
    shippingAmount: vendorOrder.shippingAmount.toFixed(2),
    taxAmount: vendorOrder.taxAmount.toFixed(2),
    totalAmount: vendorOrder.totalAmount.toFixed(2),
    items: vendorOrder.items.map(toOrderItemView),
  };
}

export function toMasterOrderView(
  masterOrder: MasterOrder & {
    vendorOrders: (VendorOrder & { items: OrderItem[] })[];
  },
): MasterOrderView {
  return {
    id: masterOrder.id,
    orderNumber: masterOrder.orderNumber,
    status: masterOrder.status,
    currency: masterOrder.currency,
    subtotal: masterOrder.subtotal.toFixed(2),
    discountAmount: masterOrder.discountAmount.toFixed(2),
    shippingAmount: masterOrder.shippingAmount.toFixed(2),
    taxAmount: masterOrder.taxAmount.toFixed(2),
    serviceFee: masterOrder.serviceFee.toFixed(2),
    totalAmount: masterOrder.totalAmount.toFixed(2),
    paymentStatus: masterOrder.paymentStatus,
    shippingAddressSnapshot: masterOrder.shippingAddressSnapshot,
    billingAddressSnapshot: masterOrder.billingAddressSnapshot,
    customerNote: masterOrder.customerNote,
    placedAt: masterOrder.placedAt,
    createdAt: masterOrder.createdAt,
    vendorOrders: masterOrder.vendorOrders.map(toVendorOrderView),
  };
}
