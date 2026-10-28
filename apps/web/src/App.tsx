import { lazy, Suspense, type ComponentType } from 'react';
import { createBrowserRouter, Link, Outlet, RouterProvider } from 'react-router';
import { BarChart3, Bike, ClipboardList, Cog, Gauge, History, ListOrdered, MessageSquareWarning, ReceiptIndianRupee, Store, Tag, UtensilsCrossed, Wrench } from 'lucide-react';
import { CustomerLayout } from './layouts/CustomerLayout';
import { DashboardLayout } from './layouts/DashboardLayout';
import { HomePage, SearchPage } from './routes/customer/Discovery';
import { RestaurantPage } from './routes/customer/RestaurantPage';
import { CheckoutPage } from './routes/customer/Checkout';
import { MockPayPage } from './routes/customer/MockPay';
import { OrdersPage } from './routes/customer/Orders';
import { OrderDetailPage } from './routes/customer/OrderDetail';
import { LoginPage, RegisterPage } from './routes/customer/Auth';
import { AccountPage } from './routes/customer/Account';
import { PartnerJoinPage, SupportPage } from './routes/customer/Static';
import { EmptyState, Spinner, Toaster } from './components/ui';

/** Operational apps are code-split so customers never download them. */
function lazyNamed<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M) {
  const C = lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })));
  return (
    <Suspense fallback={<Spinner />}>
      <C />
    </Suspense>
  );
}
const restaurant = () => import('./routes/restaurant/index');
const delivery = () => import('./routes/delivery/index');
const admin = () => import('./routes/admin/index');

function NotFound() {
  return <EmptyState title="Page not found" body="The link may be broken or the page may have moved." action={<Link to="/" className="font-semibold text-brand-700 underline">Go home</Link>} />;
}

const router = createBrowserRouter([
  {
    element: (
      <>
        <Outlet />
        <Toaster />
      </>
    ),
    children: [
      {
        element: <CustomerLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/search', element: <SearchPage /> },
          { path: '/r/:slug', element: <RestaurantPage /> },
          { path: '/checkout', element: <CheckoutPage /> },
          { path: '/pay/mock/:id', element: <MockPayPage /> },
          { path: '/orders', element: <OrdersPage /> },
          { path: '/orders/:id', element: <OrderDetailPage /> },
          { path: '/account', element: <AccountPage /> },
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/support', element: <SupportPage /> },
          { path: '/partner/join', element: <PartnerJoinPage /> },
          { path: '/partner/join/restaurant', element: <RegisterPage role="restaurant" /> },
          { path: '/partner/join/delivery', element: <RegisterPage role="delivery" /> },
          { path: '*', element: <NotFound /> },
        ],
      },
      {
        path: '/partner/restaurant',
        element: (
          <DashboardLayout
            role="restaurant"
            title="Restaurant"
            live
            nav={[
              { to: '/partner/restaurant', label: 'Orders', icon: ClipboardList, end: true },
              { to: '/partner/restaurant/menu', label: 'Menu', icon: UtensilsCrossed },
              { to: '/partner/restaurant/insights', label: 'Insights', icon: BarChart3 },
              { to: '/partner/restaurant/profile', label: 'Profile', icon: Store },
            ]}
          />
        ),
        children: [
          { index: true, element: lazyNamed(restaurant, 'RestaurantOrdersPage') },
          { path: 'menu', element: lazyNamed(restaurant, 'RestaurantMenuPage') },
          { path: 'insights', element: lazyNamed(restaurant, 'RestaurantInsightsPage') },
          { path: 'profile', element: lazyNamed(restaurant, 'RestaurantProfilePage') },
          { path: 'onboarding', element: lazyNamed(restaurant, 'RestaurantOnboardingPage') },
        ],
      },
      {
        path: '/partner/delivery',
        element: (
          <DashboardLayout
            role="delivery"
            title="Delivery partner"
            live
            nav={[
              { to: '/partner/delivery', label: 'Deliveries', icon: Bike, end: true },
              { to: '/partner/delivery/history', label: 'Earnings', icon: History },
            ]}
          />
        ),
        children: [
          { index: true, element: lazyNamed(delivery, 'DeliveryHomePage') },
          { path: 'history', element: lazyNamed(delivery, 'DeliveryHistoryPage') },
        ],
      },
      {
        path: '/admin',
        element: (
          <DashboardLayout
            role="admin"
            title="Admin"
            live
            nav={[
              { to: '/admin', label: 'Overview', icon: Gauge, end: true },
              { to: '/admin/orders', label: 'Orders', icon: ListOrdered },
              { to: '/admin/refunds', label: 'Refunds', icon: ReceiptIndianRupee },
              { to: '/admin/supply', label: 'Supply', icon: Store },
              { to: '/admin/promotions', label: 'Promotions', icon: Tag },
              { to: '/admin/settings', label: 'Fees & zones', icon: Cog },
              { to: '/admin/reviews', label: 'Reviews', icon: MessageSquareWarning },
              { to: '/admin/ops', label: 'Operations', icon: Wrench },
            ]}
          />
        ),
        children: [
          { index: true, element: lazyNamed(admin, 'AdminOverviewPage') },
          { path: 'orders', element: lazyNamed(admin, 'AdminOrdersPage') },
          { path: 'orders/:id', element: lazyNamed(admin, 'AdminOrderDetailPage') },
          { path: 'refunds', element: lazyNamed(admin, 'AdminRefundsPage') },
          { path: 'supply', element: lazyNamed(admin, 'AdminSupplyPage') },
          { path: 'promotions', element: lazyNamed(admin, 'AdminPromotionsPage') },
          { path: 'settings', element: lazyNamed(admin, 'AdminSettingsPage') },
          { path: 'reviews', element: lazyNamed(admin, 'AdminReviewsPage') },
          { path: 'ops', element: lazyNamed(admin, 'AdminOpsPage') },
        ],
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
