import React from "react";
import { createBrowserRouter, redirect } from "react-router";
import { getAviaSession } from "./api/aviaApi";

// ══════════════════════════════════════════════════════════════
// 📦 EAGER IMPORTS — must be available synchronously
// ══════════════════════════════════════════════════════════════

// Auth Pages (Eager — instant first screen)
import { Welcome } from "./components/Welcome";
// RoleSelect and EmailAuth are lazy — only needed after Welcome interaction

// Layouts (Eager — needed synchronously for route tree setup)
import { MobileLayout } from "./components/MobileLayout";
import { RootLayout }   from "./components/RootLayout";

// Error pages (Eager — must render even when chunks fail to load)
import { ErrorPage } from "./components/ErrorPage";

// AviaErrorBoundary MUST be eager — React Router instantiates ErrorBoundary
// synchronously when an error occurs; a lazy() here causes a second suspend
// inside the error-handling path, which React cannot recover from.
import { AviaErrorBoundary } from "./components/avia/AviaErrorBoundary";

// ═════════════════════════════════════════════════════════════
// 🔒 ROUTE GUARDS
// ═════════════════════════════════════════════════════════════

function requireAuth() {
  if (sessionStorage.getItem('isAuthenticated') === 'true') return null;

  try {
    const persistent = JSON.parse(localStorage.getItem('ovora_auth_persistent') || '{}');
    if (persistent.email && persistent.role) {
      sessionStorage.setItem('ovora_user_email', persistent.email);
      sessionStorage.setItem('userRole', persistent.role);
      sessionStorage.setItem('isAuthenticated', 'true');
      return null;
    }
  } catch { /* ignore */ }

  return redirect('/');
}

function requireDriver() {
  const authResult = requireAuth();
  if (authResult !== null) return authResult;
  if (sessionStorage.getItem('userRole') !== 'driver') return redirect('/home');
  return null;
}

function requireAdmin() {
  const isAuth = sessionStorage.getItem('isAuthenticated') === 'true' || (() => {
    try {
      const p = JSON.parse(localStorage.getItem('ovora_auth_persistent') || '{}');
      return !!(p.email && p.role);
    } catch { return false; }
  })();
  if (!isAuth) return redirect('/');
  // Admin PIN auth is handled by AdminLayout/AdminAuthGate — no token check here
  return null;
}

function requireAviaAuth() {
  const session = getAviaSession();
  if (!session?.user?.phone) return redirect('/avia');
  return null;
}

function redirectAviaIfAuthenticated() {
  const session = getAviaSession();
  if (session?.user?.phone) return redirect('/avia/dashboard');
  return null;
}

// ═════════════════════════════════════════════════════════════
// ⏳ HYDRATION FALLBACK
// ═════════════════════════════════════════════════════════════

function HydrateFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#060e1a' }}>
      <div className="animate-spin rounded-full h-10 w-10 border-4"
        style={{ borderColor: '#1e3a55', borderTopColor: '#5ba3f5' }} />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════
// 🗺️ ROUTER
//
// All previously React.lazy() components now use the route-level
// `lazy` property. React Router wraps these fetches in startTransition
// internally, which eliminates "suspended during synchronous input" errors.
// ═════════════════════════════════════════════════════════════

export const router = createBrowserRouter([
  {
    // Root: provides Suspense + ErrorBoundary for all child routes
    Component: RootLayout,
    errorElement: <ErrorPage />,
    // HydrateFallback at root ensures RR uses startTransition for all
    // lazy child routes on first render (SSR hydration + client navigation).
    HydrateFallback,
    children: [

      // ── Welcome & Auth ─────────────────────────────────────────────────────────
      { path: "/",        Component: Welcome },
      { path: "/welcome", Component: Welcome },
      {
        path: "/role-select",
        lazy: () => import("./components/RoleSelect").then(m => ({ Component: m.RoleSelect })),
      },
      {
        path: "/email-auth",
        lazy: () => import("./components/EmailAuth").then(m => ({ Component: m.EmailAuth })),
      },

      // ── Registration Forms (Lazy) ───────────────────────────────────────────
      {
        path: "/driver-registration-form",
        lazy: () => import("./components/DriverRegistrationForm")
          .then(m => ({ Component: m.DriverRegistrationForm })),
      },
      {
        path: "/sender-registration-form",
        lazy: () => import("./components/SenderRegistrationForm")
          .then(m => ({ Component: m.SenderRegistrationForm })),
      },

      // ── AVIA Module ─────────────────────────────────────────────────────────────
      {
        path: "/avia",
        lazy: () => import("./components/avia/AviaAuth")
          .then(m => ({ Component: m.AviaAuth })),
        loader: redirectAviaIfAuthenticated,
      },
      {
        // AviaLayout is a layout-only route (no path) — all /avia/* children
        // go through it. ErrorBoundary is EAGER (imported at top of file).
        lazy: () => import("./components/avia/AviaLayout")
          .then(m => ({ Component: m.AviaLayout })),
        ErrorBoundary: AviaErrorBoundary,
        loader: requireAviaAuth,
        children: [
          {
            path: "/avia/dashboard",
            lazy: () => import("./components/avia/AviaDashboard")
              .then(m => ({ Component: m.AviaDashboard })),
          },
          {
            path: "/avia/profile",
            lazy: () => import("./components/avia/AviaProfile")
              .then(m => ({ Component: m.AviaProfile })),
          },
          {
            path: "/avia/deals",
            lazy: () => import("./components/avia/AviaDealsPage")
              .then(m => ({ Component: m.AviaDealsPage })),
          },
          {
            path: "/avia/messages",
            lazy: () => import("./components/avia/AviaMessagesPage")
              .then(m => ({ Component: m.AviaMessagesPage })),
          },
          {
            path: "/avia/user/:phone",
            lazy: () => import("./components/avia/AviaPublicProfile")
              .then(m => ({ Component: m.AviaPublicProfile })),
          },
          {
            path: "/avia/flight/:id/manifest",
            lazy: () => import("./components/avia/AviaFlightManifestPage")
              .then(m => ({ Component: m.AviaFlightManifestPage })),
          },
        ],
      },

      // ── Client Mobile App (MobileLayout is Eager) ─────────────────────────
      {
        Component: MobileLayout,
        loader: requireAuth,
        HydrateFallback,
        children: [
          {
            path: "home",
            lazy: () => import("./components/ClientDashboard")
              .then(m => ({ Component: m.Home })),
          },
          {
            path: "dashboard",
            lazy: () => import("./components/ClientDashboard")
              .then(m => ({ Component: m.Home })),
          },
          {
            path: "search",
            lazy: () => import("./components/SearchPage")
              .then(m => ({ Component: m.SearchPage })),
          },
          {
            path: "search-results",
            lazy: () => import("./components/SearchResults")
              .then(m => ({ Component: m.SearchResults })),
          },
          {
            path: "create-trip",
            lazy: () => import("./components/CreateAnnouncementPage")
              .then(m => ({ Component: m.CreateAnnouncementPage })),
          },
          {
            path: "trip/:id",
            lazy: () => import("./components/TripDetail")
              .then(m => ({ Component: m.TripDetail })),
          },
          {
            path: "trips",
            lazy: () => import("./components/TripsPage")
              .then(m => ({ Component: m.TripsPage })),
          },
          {
            path: "tracking",
            lazy: () => import("./components/TrackingPage")
              .then(m => ({ Component: m.TrackingPage })),
          },
          {
            path: "messages",
            lazy: () => import("./components/messages/MessagesPage")
              .then(m => ({ Component: m.MessagesPage })),
          },
          {
            path: "chat/:id",
            lazy: () => import("./components/ChatPage")
              .then(m => ({ Component: m.ChatPage })),
          },
          {
            path: "profile",
            lazy: () => import("./components/ProfilePage")
              .then(m => ({ Component: m.ProfilePage })),
          },
          {
            path: "profile/edit",
            lazy: () => import("./components/EditProfile")
              .then(m => ({ Component: m.EditProfile })),
          },
          {
            path: "notifications",
            lazy: () => import("./components/NotificationsPage")
              .then(m => ({ Component: m.NotificationsPage })),
          },
          {
            path: "payments",
            lazy: () => import("./components/PaymentHistory")
              .then(m => ({ Component: m.PaymentHistory })),
          },
          {
            path: "reviews",
            lazy: () => import("./components/ReviewsPage")
              .then(m => ({ Component: m.ReviewsPage })),
          },
          {
            path: "documents",
            lazy: () => import("./components/DocumentVerificationPage")
              .then(m => ({ Component: m.DocumentVerificationPage })),
          },
          {
            path: "settings",
            lazy: () => import("./components/SettingsPage")
              .then(m => ({ Component: m.SettingsPage })),
          },
          {
            path: "help",
            lazy: () => import("./components/HelpPage")
              .then(m => ({ Component: m.HelpPage })),
          },
          {
            path: "about",
            lazy: () => import("./components/AboutPage")
              .then(m => ({ Component: m.AboutPage })),
          },
          {
            path: "calculator",
            lazy: () => import("./components/PriceCalculator")
              .then(m => ({ Component: m.PriceCalculator })),
          },
          {
            path: "favorites",
            lazy: () => import("./components/FavoritesPage")
              .then(m => ({ Component: m.FavoritesPage })),
          },
          {
            path: "privacy-policy",
            lazy: () => import("./components/PrivacyPolicyPage")
              .then(m => ({ Component: m.PrivacyPolicyPage })),
          },
          {
            path: "terms-of-service",
            lazy: () => import("./components/TermsOfServicePage")
              .then(m => ({ Component: m.TermsOfServicePage })),
          },
          // ── Driver-specific (requires driver role) ──
          {
            path: "driver-stats",
            loader: requireDriver,
            lazy: () => import("./components/DriverStatsPage")
              .then(m => ({ Component: m.DriverStatsPage })),
          },
          {
            path: "borders",
            loader: requireDriver,
            lazy: () => import("./components/BordersPage")
              .then(m => ({ Component: m.BordersPage })),
          },
          {
            path: "rest-stops",
            loader: requireDriver,
            lazy: () => import("./components/RestStopsPage")
              .then(m => ({ Component: m.RestStopsPage })),
          },
          {
            path: "radio",
            loader: requireDriver,
            lazy: () => import("./components/RadioPage")
              .then(m => ({ Component: m.RadioPage })),
          },
          {
            path: "subscription",
            lazy: () => import("./components/SubscriptionPage")
              .then(m => ({ Component: m.SubscriptionPage })),
          },
        ],
      },

      // ── Admin Panel ─────────────────────────────────────────────────────────────
      {
        path: "/admin",
        lazy: () => import("./components/admin/AdminLayout")
          .then(m => ({ Component: m.AdminLayout })),
        loader: requireAdmin,
        HydrateFallback,
        children: [
          {
            index: true,
            lazy: () => import("./components/admin/AdminDashboard")
              .then(m => ({ Component: m.AdminDashboard })),
          },
          {
            path: "notifications",
            lazy: () => import("./components/admin/NotificationCenter")
              .then(m => ({ Component: m.NotificationCenter })),
          },
          {
            path: "cargo/drivers",
            lazy: () => import("./components/admin/DriversManagement")
              .then(m => ({ Component: m.DriversManagement })),
          },
          {
            path: "cargo/users",
            lazy: () => import("./components/admin/UsersManagement")
              .then(m => ({ Component: m.UsersManagement })),
          },
          {
            path: "cargo/trips",
            lazy: () => import("./components/admin/TripsManagement")
              .then(m => ({ Component: m.TripsManagement })),
          },
          {
            path: "cargo/verification",
            lazy: () => import("./components/admin/DocumentVerification")
              .then(m => ({ Component: m.DocumentVerification })),
          },
          {
            path: "blacklist",
            lazy: () => import("./components/admin/BlacklistManagement")
              .then(m => ({ Component: m.BlacklistManagement })),
          },
          {
            path: "cargo/analytics",
            lazy: () => import("./components/admin/Analytics")
              .then(m => ({ Component: m.Analytics })),
          },
          {
            path: "cargo/reviews",
            lazy: () => import("./components/admin/Reviews")
              .then(m => ({ Component: m.Reviews })),
          },
          {
            path: "codes",
            lazy: () => import("./components/admin/CodeManagement")
              .then(m => ({ Component: m.CodeManagement })),
          },
          {
            path: "cargo/offers",
            lazy: () => import("./components/admin/OffersManagement")
              .then(m => ({ Component: m.OffersManagement })),
          },
          {
            path: "cargo/cargos",
            lazy: () => import("./components/admin/CargosManagement")
              .then(m => ({ Component: m.CargosManagement })),
          },
          {
            path: "ads",
            lazy: () => import("./components/admin/AdsManagement")
              .then(m => ({ Component: m.AdsManagement })),
          },
          {
            path: "cargo/settings",
            lazy: () => import("./components/admin/Settings")
              .then(m => ({ Component: m.Settings })),
          },
          {
            path: "cargo/subscriptions",
            lazy: () => import("./components/admin/SubscriptionManagement")
              .then(m => ({ Component: m.SubscriptionManagement })),
          },
          {
            path: "cargo/audit",
            lazy: () => import("./components/admin/CargoAuditLog")
              .then(m => ({ Component: m.CargoAuditLog })),
          },
          {
            path: "cargo/chats",
            lazy: () => import("./components/admin/ChatsManagement")
              .then(m => ({ Component: m.ChatsManagement })),
          },
          {
            path: "site",
            lazy: () => import("./components/admin/SiteSettingsPage")
              .then(m => ({ Component: m.SiteSettingsPage })),
          },
          {
            path: "avia/users",
            lazy: () => import("./components/admin/AviaUsersManagement")
              .then(m => ({ Component: m.AviaUsersManagement })),
          },
          {
            path: "avia/cards",
            lazy: () => import("./components/admin/AviaCardsManagement")
              .then(m => ({ Component: m.AviaCardsManagement })),
          },
          {
            path: "avia/analytics",
            lazy: () => import("./components/admin/AviaAnalytics")
              .then(m => ({ Component: m.AviaAnalytics })),
          },
          {
            path: "avia/settings",
            lazy: () => import("./components/admin/AviaSettings")
              .then(m => ({ Component: m.AviaSettings })),
          },
          {
            path: "avia/audit",
            lazy: () => import("./components/admin/AviaAuditLog")
              .then(m => ({ Component: m.AviaAuditLog })),
          },
          {
            path: "avia/blacklist",
            lazy: () => import("./components/admin/AviaBlacklistManagement")
              .then(m => ({ Component: m.AviaBlacklistManagement })),
          },
        ],
      },

      // ── Standalone pages ───────────────────────────────────────────────────────
      {
        path: "/competitor-analysis",
        lazy: () => import("./components/CompetitorAnalysisPage")
          .then(m => ({ Component: m.CompetitorAnalysisPage })),
      },
      {
        path: "/track/:tripId",
        lazy: () => import("./components/PublicTrackingPage")
          .then(m => ({ Component: m.PublicTrackingPage })),
      },

      // ── Catch-all redirects ───────────────────────────────────────────────
      { path: "map-test", loader: () => redirect("/home") },
      { path: "database", loader: () => redirect("/home") },
      { path: "health",   loader: () => redirect("/home") },
      {
        path: "*",
        HydrateFallback,
        loader: () => redirect("/"),
      },
    ],
  },
], { basename: '/' });