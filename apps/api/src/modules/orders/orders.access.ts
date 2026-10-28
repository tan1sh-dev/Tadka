import type { AuthUser } from '../../middleware/auth';
import { OrderModel } from '../../models/order';
import { AssignmentModel } from '../../models/ops';
import { RestaurantModel } from '../../models/restaurant';

/**
 * Resource-level authorisation for orders, shared by REST and Socket.IO.
 * Returns the viewer role under which the user may see the order, or null.
 */
export async function orderViewerRole(user: AuthUser, orderId: string): Promise<'customer' | 'restaurant' | 'delivery' | 'admin' | null> {
  if (!/^[a-f0-9]{24}$/i.test(orderId)) return null;
  const order = await OrderModel.findById(orderId).select('customerId restaurantId').lean();
  if (!order) return null;
  switch (user.role) {
    case 'admin':
      return 'admin';
    case 'customer':
      return String(order.customerId) === user.id ? 'customer' : null;
    case 'restaurant':
      return (await RestaurantModel.exists({ _id: order.restaurantId, ownerId: user.id })) ? 'restaurant' : null;
    case 'delivery':
      // Only the current partner (offered, active or delivered by them). Declined/reassigned partners lose access.
      return (await AssignmentModel.exists({ orderId, partnerId: user.id })) ? 'delivery' : null;
  }
}
