import express from 'express';
import authRoute from './auth.route.js';
import adminRoute from './admin.route.js';
import planRoute from './plan.route.js';
import segmentRoute from './segment.route.js';
import subscriptionRoute from './subscription.route.js';
import paymentRoute from './payment.route.js';
import signalRoute from './signal.route.js';
import dashboardRoute from './dashboard.route.js';
import subBrokerRoute from './subBroker.route.js';
import settingRoute from './setting.route.js';
import marketRoute from './market.route.js';
import ticketRoute from './ticket.route.js';
import analyticsRoute from './analytics.route.js';
import announcementRoute from './announcement.route.js';
import economicRoute from './economic.route.js';
import cmsRoute from './cms.route.js';

import healthRoute from './health.route.js';
import notificationRoute from './notification.route.js';
import searchRoute from './search.route.js';
import leadRoute from './lead.route.js';
import botRoute from './bot.route.js';
import metricsRoute from './metrics.route.js';

import watchlistRoute from './watchlist.routes.js';

const router = express.Router();

const defaultRoutes = [
  {
      path: '/bot',
      route: botRoute,
  },
  {
    path: '/leads',
    route: leadRoute,
  },
  {
    path: '/watchlist',
    route: watchlistRoute,
  },
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/health',
    route: healthRoute,
  },
  {
    path: '/admin',
    route: adminRoute,
  },
  {
    path: '/plans',
    route: planRoute,
  },
  {
    path: '/segments',
    route: segmentRoute,
  },
  {
    path: '/subscribe',
    route: subscriptionRoute,
  },
  {
    path: '/subscriptions',
    route: subscriptionRoute,
  },
  {
    path: '/payments',
    route: paymentRoute,
  },
  {
    path: '/signals',
    route: signalRoute,
  },
  {
    path: '/dashboard', // Covers tickets and stats
    route: dashboardRoute,
  },
  {
    path: '/sub-brokers',
    route: subBrokerRoute,
  },
  {
    path: '/settings',
    route: settingRoute,
  },
  {
    path: '/market',
    route: marketRoute,
  },
  {
    path: '/tickets',
    route: ticketRoute,
  },
  {
    path: '/analytics',
    route: analyticsRoute,
  },
  {
    path: '/announcements',
    route: announcementRoute,
  },
  {
    path: '/economic-calendar',
    route: economicRoute,
  },
  {
    path: '/cms',
    route: cmsRoute,
  },
  {
    path: '/notifications',
    route: notificationRoute,
  },
  {
    path: '/search',
    route: searchRoute,
  },
  {
      path: '/metrics',
      route: metricsRoute
  }
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
