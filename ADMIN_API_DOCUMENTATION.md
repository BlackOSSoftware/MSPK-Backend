# Admin API Documentation (All APIs with Body + Response)

Project: MSPK-Backend  
Base URL: `http://localhost:4000/v1`

This documentation is for admin-side APIs in very simple English.

## 0) Login First (Required)

### 0.1 Admin Login
- Method: `POST`
- URL: `http://localhost:4000/v1/auth/login`
- Auth: Not required
- Request Body (JSON):
```json
{
  "email": "admin@example.com",
  "password": "secret123",
  "deviceId": "admin-web-1"
}
```
- Response (200 example):
```json
{
  "user": {
    "_id": "admin123",
    "name": "Admin",
    "email": "admin@example.com",
    "role": "admin"
  },
  "token": "<jwt_token>"
}
```

Use this token in all admin APIs:
- `Authorization: Bearer <jwt_token>`

## 1) Admin Users (`/v1/admin`)

### 1.1 Get all users
- Method: `GET`
- URL: `http://localhost:4000/v1/admin/users`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
[
  {
    "id": "u123",
    "name": "Rahul",
    "email": "rahul@example.com",
    "phone": "9876543210",
    "role": "user",
    "plan": "Premium",
    "planStatus": "Active",
    "status": "Active",
    "walletBalance": 5000,
    "equity": 10000,
    "pnl": 200
  }
]
```

### 1.2 Create user
- Method: `POST`
- URL: `http://localhost:4000/v1/admin/users`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "email": "newuser@example.com",
  "password": "secret123",
  "name": "New User",
  "phone": "9876543210",
  "role": "user",
  "clientId": "CL-1001",
  "equity": 10000,
  "walletBalance": 5000,
  "subBrokerId": null,
  "planId": "65f0abcdef12345678901234",
  "status": "Active"
}
```
- Response (201 example):
```json
{
  "_id": "u456",
  "name": "New User",
  "email": "newuser@example.com",
  "phone": "9876543210",
  "role": "user",
  "status": "Active",
  "isEmailVerified": true
}
```

### 1.3 Get one user
- Method: `GET`
- URL: `http://localhost:4000/v1/admin/users/:userId`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "id": "u123",
  "name": "Rahul",
  "email": "rahul@example.com",
  "plan": "Premium",
  "planStatus": "Active",
  "subscriptionHistory": [
    {
      "id": "sub1",
      "plan": "Premium",
      "amount": "INR 1999",
      "status": "active"
    }
  ],
  "signals": []
}
```

### 1.4 Update user
- Method: `PATCH`
- URL: `http://localhost:4000/v1/admin/users/:userId`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "name": "Rahul Sharma",
  "phone": "9999999999",
  "walletBalance": 9000,
  "status": "Active",
  "planId": "65f0abcdef12345678901234"
}
```
- Response (200 example):
```json
{
  "_id": "u123",
  "name": "Rahul Sharma",
  "phone": "9999999999",
  "walletBalance": 9000,
  "status": "Active"
}
```

### 1.5 Delete user
- Method: `DELETE`
- URL: `http://localhost:4000/v1/admin/users/:userId`
- Auth: Admin required
- Request Body: `No body`
- Response: `204 No Content`

### 1.6 Update user signal access
- Method: `PATCH`
- URL: `http://localhost:4000/v1/admin/users/:userId/signals`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "category": "NIFTY_OPT",
  "access": true,
  "expiry": "2026-12-31T23:59:59.000Z"
}
```
- Response (200 example):
```json
{
  "message": "Signal access updated",
  "signals": [
    {
      "category": "Nifty 50 Options",
      "key": "NIFTY_OPT",
      "access": true,
      "expiry": "2026-12-31T23:59:59.000Z",
      "source": "override"
    }
  ]
}
```

### 1.7 Block or Unblock user
- Method: `PATCH`
- URL: `http://localhost:4000/v1/admin/users/:userId/block`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "_id": "u123",
  "status": "Blocked"
}
```

### 1.8 Liquidate user
- Method: `PATCH`
- URL: `http://localhost:4000/v1/admin/users/:userId/liquidate`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "_id": "u123",
  "status": "Liquidated",
  "equity": 0,
  "marginUsed": 0,
  "pnl": 0
}
```

### 1.9 Admin system health
- Method: `GET`
- URL: `http://localhost:4000/v1/admin/system/health`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "status": "OK",
  "components": {
    "redis": "UP",
    "database": "UP"
  },
  "memory": {
    "rss": "120 MB",
    "heapTotal": "60 MB"
  }
}
```

### 1.10 Broadcast announcement
- Method: `POST`
- URL: `http://localhost:4000/v1/admin/broadcast`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "title": "Server Notice",
  "message": "Maintenance at 11 PM",
  "targetAudience": {
    "role": "all"
  }
}
```
- Response (201 example):
```json
{
  "message": "Broadcast scheduled successfully",
  "announcementId": "ann123"
}
```

## 2) Analytics

### 2.1 Get analytics
- Method: `GET`
- URL: `http://localhost:4000/v1/analytics?type=revenue&range=month`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "summary": {
    "total": 100000,
    "growth": 12.5
  },
  "series": [
    { "label": "Week 1", "value": 25000 }
  ]
}
```

### 2.2 Export analytics CSV
- Method: `GET`
- URL: `http://localhost:4000/v1/analytics/export?type=revenue&range=month`
- Auth: Admin required
- Request Body: `No body`
- Response: CSV file

## 3) Settings

### 3.1 Get settings
- Method: `GET`
- URL: `http://localhost:4000/v1/settings`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "site_name": "MSPK",
  "data_feed_api_key": "********",
  "kite_api_secret": "********"
}
```

### 3.2 Update one setting
- Method: `PATCH`
- URL: `http://localhost:4000/v1/settings`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "key": "site_name",
  "value": "MSPK Pro"
}
```
- Response (200 example):
```json
{
  "_id": "set123",
  "key": "site_name",
  "value": "MSPK Pro"
}
```

### 3.3 Update bulk settings
- Method: `PUT`
- URL: `http://localhost:4000/v1/settings/bulk`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "site_name": "MSPK Pro",
  "frontend_url": "http://localhost:5173"
}
```
- Response (200 example):
```json
{
  "message": "Settings updated successfully"
}
```

## 4) Plans (Admin Write APIs)

### 4.1 Create plan
- Method: `POST`
- URL: `http://localhost:4000/v1/plans`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "name": "Premium FNO",
  "description": "FNO plan",
  "segment": "FNO",
  "price": 1999,
  "durationDays": 30,
  "features": ["Nifty Options", "BankNifty Options"],
  "isActive": true,
  "isDemo": false
}
```
- Response (201 example):
```json
{
  "_id": "plan123",
  "name": "Premium FNO",
  "segment": "FNO",
  "price": 1999,
  "durationDays": 30,
  "isActive": true,
  "isDemo": false
}
```

### 4.2 Update plan
- Method: `PATCH`
- URL: `http://localhost:4000/v1/plans/:planId`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "price": 1499,
  "isActive": true
}
```
- Response (200 example):
```json
{
  "_id": "plan123",
  "price": 1499,
  "isActive": true
}
```

### 4.3 Delete plan
- Method: `DELETE`
- URL: `http://localhost:4000/v1/plans/:planId`
- Auth: Admin required
- Request Body: `No body`
- Response: `204 No Content`

## 5) Signals (Admin Write APIs)

### 5.1 Create signal
- Method: `POST`
- URL: `http://localhost:4000/v1/signals`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "symbol": "NSE:NIFTY 50-INDEX",
  "segment": "FNO",
  "type": "BUY",
  "entryPrice": 22500,
  "stopLoss": 22350,
  "targets": {
    "target1": 22600,
    "target2": 22700,
    "target3": 22800
  },
  "isFree": false,
  "notes": "Breakout setup"
}
```
- Response (201 example):
```json
{
  "_id": "sig123",
  "symbol": "NSE:NIFTY 50-INDEX",
  "status": "Active"
}
```

### 5.2 Create manual signal
- Method: `POST`
- URL: `http://localhost:4000/v1/signals/manual`
- Auth: Admin required
- Request Body: same as create signal
- Response (201 example):
```json
{
  "_id": "sig124",
  "symbol": "NSE:NIFTY 50-INDEX",
  "status": "Active",
  "isManual": true
}
```

### 5.3 Update signal
- Method: `PATCH`
- URL: `http://localhost:4000/v1/signals/:signalId`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "status": "Target Hit",
  "notes": "Target 1 achieved"
}
```
- Response (200 example):
```json
{
  "_id": "sig123",
  "status": "Target Hit",
  "notes": "Target 1 achieved"
}
```

### 5.4 Delete signal
- Method: `DELETE`
- URL: `http://localhost:4000/v1/signals/:signalId`
- Auth: Admin required
- Request Body: `No body`
- Response: `204 No Content`

## 6) Leads (Admin APIs)

### 6.1 Get all leads
- Method: `GET`
- URL: `http://localhost:4000/v1/leads`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
[
  {
    "_id": "lead123",
    "name": "Aman",
    "email": "aman@example.com",
    "status": "NEW"
  }
]
```

### 6.2 Get one lead
- Method: `GET`
- URL: `http://localhost:4000/v1/leads/:id`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "_id": "lead123",
  "name": "Aman",
  "email": "aman@example.com",
  "status": "NEW"
}
```

### 6.3 Update lead
- Method: `PATCH`
- URL: `http://localhost:4000/v1/leads/:id`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "status": "FOLLOW_UP",
  "city": "Mumbai"
}
```
- Response (200 example):
```json
{
  "_id": "lead123",
  "status": "FOLLOW_UP",
  "city": "Mumbai"
}
```

### 6.4 Delete lead
- Method: `DELETE`
- URL: `http://localhost:4000/v1/leads/:id`
- Auth: Admin required
- Request Body: `No body`
- Response: `204 No Content`

### 6.5 Approve lead
- Method: `POST`
- URL: `http://localhost:4000/v1/leads/:id/approve`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "user": {
    "_id": "u777",
    "email": "lead@example.com"
  },
  "message": "Lead approved and subscriptions created successfully"
}
```

## 7) Tickets (Admin)

### 7.1 Update ticket status
- Method: `PATCH`
- URL: `http://localhost:4000/v1/tickets/:id`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "status": "resolved"
}
```
- Response (200 example):
```json
{
  "_id": "ticket123",
  "ticketId": "TK-1007",
  "status": "resolved"
}
```

## 8) Dashboard (Admin)

### 8.1 Get dashboard stats
- Method: `GET`
- URL: `http://localhost:4000/v1/dashboard/stats`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "totalUsers": 150,
  "activeUsers": 90,
  "totalRevenue": 250000,
  "openTickets": 12
}
```

### 8.2 Get all dashboard tickets
- Method: `GET`
- URL: `http://localhost:4000/v1/dashboard/admin/tickets?status=pending`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
[
  {
    "_id": "ticket123",
    "ticketId": "TK-1007",
    "subject": "Payment issue",
    "status": "pending"
  }
]
```

## 9) Payments (Admin)

### 9.1 Update payment details
- Method: `PUT`
- URL: `http://localhost:4000/v1/payments/details`
- Auth: Admin required
- Request Body: `form-data`
- Form fields:
- `upiId` (text)
- `accountHolderName` (text)
- `bankName` (text)
- `accountNumber` (text)
- `ifsc` (text)
- `qrCode` (file, optional)
- Response (200 example):
```json
{
  "_id": "payset123",
  "upiId": "mspk@upi",
  "accountHolderName": "MSPK",
  "bankName": "HDFC",
  "accountNumber": "XXXX1234",
  "ifsc": "HDFC0001234",
  "qrCodeUrl": "uploads/qr/qr.png"
}
```

## 10) Sub-Broker (Admin)

### 10.1 Create sub-broker
- Method: `POST`
- URL: `http://localhost:4000/v1/sub-brokers`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "name": "Broker A",
  "email": "broker@example.com",
  "phone": "9876543210",
  "commissionRate": 20
}
```
- Response (201 example):
```json
{
  "_id": "sb123",
  "name": "Broker A",
  "email": "broker@example.com",
  "commissionRate": 20
}
```

### 10.2 Get all sub-brokers
- Method: `GET`
- URL: `http://localhost:4000/v1/sub-brokers`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
[
  {
    "_id": "sb123",
    "name": "Broker A",
    "commissionRate": 20
  }
]
```

### 10.3 Get sub-broker details
- Method: `GET`
- URL: `http://localhost:4000/v1/sub-brokers/:subBrokerId`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "subBroker": {
    "_id": "sb123",
    "name": "Broker A"
  },
  "clients": [],
  "commissions": []
}
```

### 10.4 Update sub-broker
- Method: `PATCH`
- URL: `http://localhost:4000/v1/sub-brokers/:subBrokerId`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "name": "Broker A Updated",
  "commissionRate": 25
}
```
- Response (200 example):
```json
{
  "_id": "sb123",
  "name": "Broker A Updated",
  "commissionRate": 25
}
```

### 10.5 Delete sub-broker
- Method: `DELETE`
- URL: `http://localhost:4000/v1/sub-brokers/:subBrokerId`
- Auth: Admin required
- Request Body: `No body`
- Response: `204 No Content`

### 10.6 Process payout
- Method: `POST`
- URL: `http://localhost:4000/v1/sub-brokers/:subBrokerId/payout`
- Auth: Admin required
- Request Body: `No body`
- Response (200 example):
```json
{
  "message": "Payout processed successfully",
  "result": {
    "processed": 3,
    "totalAmount": 4500
  }
}
```

## 11) CMS (Admin Write)

### 11.1 Update page
- Method: `POST`
- URL: `http://localhost:4000/v1/cms/pages/:slug`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "title": "About Us",
  "content": "This is about page content"
}
```
- Response (200 example):
```json
{
  "_id": "page123",
  "slug": "about",
  "title": "About Us",
  "content": "This is about page content"
}
```

### 11.2 Create FAQ
- Method: `POST`
- URL: `http://localhost:4000/v1/cms/faqs`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "question": "How to buy plan?",
  "answer": "Go to plans and select one."
}
```
- Response (201 example):
```json
{
  "_id": "faq123",
  "question": "How to buy plan?",
  "answer": "Go to plans and select one."
}
```

### 11.3 Update FAQ
- Method: `PATCH`
- URL: `http://localhost:4000/v1/cms/faqs/:id`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "question": "How to buy premium plan?",
  "answer": "Open plans page and subscribe."
}
```
- Response (200 example):
```json
{
  "_id": "faq123",
  "question": "How to buy premium plan?",
  "answer": "Open plans page and subscribe."
}
```

### 11.4 Delete FAQ
- Method: `DELETE`
- URL: `http://localhost:4000/v1/cms/faqs/:id`
- Auth: Admin required
- Request Body: `No body`
- Response: `204 No Content`

## 12) Bot Control

### 12.1 Toggle bot ON/OFF
- Method: `POST`
- URL: `http://localhost:4000/v1/bot/toggle`
- Auth: Admin required
- Request Body (JSON):
```json
{
  "status": "ON"
}
```
- Response (200 example):
```json
{
  "status": "ON",
  "message": "Bot turned ON"
}
```

## 13) Admin-Used APIs (Current Route Protection is Weak)

These are typically admin operations, but code currently does not enforce strict admin on route.

### 13.1 Get all subscriptions (admin panel use)
- Method: `GET`
- URL: `http://localhost:4000/v1/subscriptions/admin/all`
- Auth: Currently any logged-in user
- Request Body: `No body`
- Response (200 example):
```json
[
  {
    "_id": "sub1",
    "user": "u123",
    "plan": "plan123",
    "status": "active",
    "startDate": "2026-02-01T00:00:00.000Z",
    "endDate": "2026-03-02T00:00:00.000Z"
  }
]
```

### 13.2 Create announcement
- Method: `POST`
- URL: `http://localhost:4000/v1/announcements`
- Auth: Currently not protected in route
- Request Body (JSON):
```json
{
  "title": "Big Update",
  "message": "New feature released.",
  "type": "UPDATE",
  "priority": "HIGH",
  "targetAudience": {
    "role": "all",
    "planValues": [],
    "segments": []
  },
  "startDate": "2026-03-01T10:00:00.000Z",
  "endDate": "2026-03-05T10:00:00.000Z",
  "isActive": true
}
```
- Response (201 example):
```json
{
  "_id": "ann1",
  "title": "Big Update",
  "message": "New feature released.",
  "type": "UPDATE",
  "priority": "HIGH",
  "isActive": true
}
```

### 13.3 Update announcement
- Method: `PATCH`
- URL: `http://localhost:4000/v1/announcements/:announcementId`
- Auth: Currently not protected in route
- Request Body (JSON):
```json
{
  "title": "Big Update v2",
  "message": "Updated message",
  "priority": "CRITICAL",
  "isActive": true
}
```
- Response (200 example):
```json
{
  "_id": "ann1",
  "title": "Big Update v2",
  "message": "Updated message",
  "priority": "CRITICAL",
  "isActive": true
}
```

### 13.4 Delete announcement
- Method: `DELETE`
- URL: `http://localhost:4000/v1/announcements/:announcementId`
- Auth: Currently not protected in route
- Request Body: `No body`
- Response: `204 No Content`

### 13.5 Seed market master data
- Method: `POST`
- URL: `http://localhost:4000/v1/market/seed`
- Auth: Currently not protected in route
- Request Body: `No body`
- Response (201 example):
```json
{
  "message": "Market Master Data Seeded Successfully"
}
```

### 13.6 Create market segment
- Method: `POST`
- URL: `http://localhost:4000/v1/market/segments`
- Auth: Currently not protected in route
- Request Body (JSON):
```json
{
  "name": "Equity Intraday",
  "code": "EQUITY"
}
```
- Response (201 example):
```json
{
  "_id": "seg1",
  "name": "Equity Intraday",
  "code": "EQUITY",
  "isActive": true
}
```

### 13.7 Update market segment
- Method: `PATCH`
- URL: `http://localhost:4000/v1/market/segments/:id`
- Auth: Currently not protected in route
- Request Body (JSON):
```json
{
  "name": "Equity Intraday Updated",
  "isActive": true
}
```
- Response (200 example):
```json
{
  "_id": "seg1",
  "name": "Equity Intraday Updated",
  "code": "EQUITY",
  "isActive": true
}
```

### 13.8 Delete market segment
- Method: `DELETE`
- URL: `http://localhost:4000/v1/market/segments/:id`
- Auth: Currently not protected in route
- Request Body: `No body`
- Response: `204 No Content`

### 13.9 Create market symbol
- Method: `POST`
- URL: `http://localhost:4000/v1/market/symbols`
- Auth: Currently not protected in route
- Request Body (JSON):
```json
{
  "symbol": "NSE:RELIANCE-EQ",
  "name": "Reliance Industries",
  "segment": "EQUITY",
  "exchange": "NSE",
  "lotSize": 1,
  "tickSize": 0.05,
  "instrumentToken": "123456",
  "isWatchlist": true,
  "isActive": true
}
```
- Response (201 example):
```json
{
  "_id": "sym1",
  "symbol": "NSE:RELIANCE-EQ",
  "name": "Reliance Industries",
  "segment": "EQUITY",
  "exchange": "NSE",
  "isWatchlist": true,
  "isActive": true
}
```

### 13.10 Update market symbol
- Method: `PATCH`
- URL: `http://localhost:4000/v1/market/symbols/:id`
- Auth: Currently not protected in route
- Request Body (JSON):
```json
{
  "name": "Reliance Industries Ltd",
  "isWatchlist": false,
  "isActive": true
}
```
- Response (200 example):
```json
{
  "_id": "sym1",
  "name": "Reliance Industries Ltd",
  "isWatchlist": false,
  "isActive": true
}
```

### 13.11 Delete market symbol
- Method: `DELETE`
- URL: `http://localhost:4000/v1/market/symbols/:id`
- Auth: Currently not protected in route
- Request Body: `No body`
- Response: `204 No Content`

### 13.12 Sync market instruments
- Method: `POST`
- URL: `http://localhost:4000/v1/market/sync`
- Auth: Currently not protected in route
- Request Body: `No body`
- Response (200 example):
```json
{
  "message": "Sync completed",
  "inserted": 120,
  "updated": 80
}
```

## 14) Common Error Response

```json
{
  "status": "error",
  "statusCode": 401,
  "message": "Please authenticate"
}
```

Common status codes:
- `400` Bad request
- `401` Unauthorized
- `403` Forbidden
- `404` Not found
- `500` Internal server error
