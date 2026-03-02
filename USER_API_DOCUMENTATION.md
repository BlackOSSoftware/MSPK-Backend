# User API Documentation (A to Z, Simple English)

Project: MSPK-Backend  
Main Base URL: `http://localhost:4000/v1`

Auth Base URL: `http://localhost:4000/v1/auth`

This file is for **normal app user APIs** (public + logged-in user).  
Admin-only APIs are not included.

## 1. Easy Flow (Start to End)

Follow this order:

1. Register user
2. Send OTP to email
3. Verify email OTP
4. Login
5. **Immediately send FCM token** (important for push notifications)
6. Use all private user APIs with Bearer token

Important:
- Login/private APIs require verified email.
- Private API means: add `Authorization: Bearer <token>`.

## 2. Header Rules

Public API:
- No token needed.

Private API:
- Header required: `Authorization: Bearer <token>`

Content type:
- JSON API: `Content-Type: application/json`
- File API: `form-data`

## 3. Auth APIs (`/v1/auth`)

### 3.1 Register

`POST http://localhost:4000/v1/auth/register`  
Authorization: Not required

Body:
```json
{
  "email": "student@example.com",
  "password": "secret123",
  "name": "Student",
  "phone": "9876543210",
  "referralCode": "ABC123"
}
```

Success (201):
```json
{
  "user": {
    "_id": "65f1...",
    "email": "student@example.com",
    "name": "Student",
    "isEmailVerified": false,
    "status": "Active"
  },
  "token": "<jwt_token>"
}
```

### 3.2 Send Email OTP

`POST http://localhost:4000/v1/auth/send-otp`  
Authorization: Not required

Body:
```json
{
  "type": "email",
  "identifier": "student@example.com"
}
```

Success (200):
```json
{
  "message": "OTP sent successfully to email",
  "dailyRemaining": 4
}
```

### 3.3 Verify Email OTP

`POST http://localhost:4000/v1/auth/verify-otp`  
Authorization: Not required

Body:
```json
{
  "type": "email",
  "identifier": "student@example.com",
  "otp": "123456"
}
```

Success (200):
```json
{
  "message": "Email verified successfully",
  "verified": true,
  "verificationToken": "<email_verification_token>"
}
```

### 3.4 Login

`POST http://localhost:4000/v1/auth/login`  
Authorization: Not required

Body:
```json
{
  "email": "student@example.com",
  "password": "secret123",
  "deviceId": "android-device-1"
}
```

Success (200):
```json
{
  "user": {
    "_id": "65f1...",
    "email": "student@example.com",
    "name": "Student",
    "isEmailVerified": true
  },
  "token": "<jwt_token>"
}
```

### 3.5 Login ke turant baad FCM token hit karna hai

`POST http://localhost:4000/v1/notifications/fcm-token`  
Authorization: **Required** (`Bearer <login token>`)

Body:
```json
{
  "token": "<fcm_device_token>"
}
```

Success (200):
```json
{
  "message": "Token registered successfully"
}
```

### 3.6 My Profile

`GET http://localhost:4000/v1/auth/me`  
Authorization: Required

`PATCH http://localhost:4000/v1/auth/me`  
Authorization: Required

Body example:
```json
{
  "name": "New Name",
  "phone": "9999999999",
  "profile": {
    "address": "Street 1",
    "city": "Mumbai",
    "state": "MH"
  }
}
```

### 3.7 Change Password

`POST http://localhost:4000/v1/auth/change-password`  
Authorization: Required

Body:
```json
{
  "oldPassword": "secret123",
  "newPassword": "newsecret123",
  "confirmNewPassword": "newsecret123"
}
```

Success:
```json
{
  "message": "Password changed successfully. Please log in again."
}
```

### 3.8 Logout

`POST http://localhost:4000/v1/auth/logout`  
Authorization: Required

Success:
```json
{
  "message": "Logged out successfully."
}
```

## 4. Plans and Segments

### 4.1 Get all plans (public)

`GET http://localhost:4000/v1/plans`  
Authorization: Not required

Optional query:
- `role=user`

### 4.2 Get plan by ID (public)

`GET http://localhost:4000/v1/plans/:planId`  
Authorization: Not required

### 4.3 Get subscription segments (public)

`GET http://localhost:4000/v1/segments`  
Authorization: Not required

## 5. Subscription APIs

### 5.1 Purchase subscription

`POST http://localhost:4000/v1/subscribe/purchase`  
Authorization: Required

Body:
```json
{
  "segments": ["EQUITY", "FNO"],
  "planType": "premium"
}
```

Success (201): returns subscription object.

### 5.2 Check my subscription status

`GET http://localhost:4000/v1/subscribe/status`  
Authorization: Required

Success:
```json
{
  "hasActiveSubscription": true,
  "subscription": {
    "_id": "..."
  }
}
```

### 5.3 Check access by segment

`GET http://localhost:4000/v1/subscribe/has-access/:segment`  
Authorization: Required

Example: `/subscribe/has-access/EQUITY`

Success:
```json
{
  "segment": "EQUITY",
  "hasAccess": true
}
```

## 6. Payment APIs

### 6.1 Get payment details (UPI/QR data)

`GET http://localhost:4000/v1/payments/details`  
Authorization: Required

Success: returns payment detail object.

### 6.2 Submit manual payment

`POST http://localhost:4000/v1/payments/verify-payment`  
Authorization: Required  
Content type: `form-data`

Fields:
- `segmentCodes` (text, JSON string) example: `["EQUITY","FNO"]`
- `transactionId` (text)
- `screenshot` (file, required)

Success (201):
```json
{
  "message": "Payment submitted for verification",
  "subscription": {
    "_id": "...",
    "status": "pending"
  }
}
```

## 7. Signals APIs

### 7.1 Get signals list

`GET http://localhost:4000/v1/signals`  
Authorization: Optional (without token only free/limited data)

Useful query params:
- `page`, `limit`, `search`, `symbol`, `status`, `segment`, `type`, `timeframe`

Success:
```json
{
  "results": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalPages": 1,
    "totalResults": 0
  },
  "stats": {}
}
```

### 7.2 Get one signal

`GET http://localhost:4000/v1/signals/:signalId`  
Authorization: Optional

### 7.3 Signal analysis

`GET http://localhost:4000/v1/signals/:signalId/analysis`  
Authorization: Optional

Success:
```json
{
  "symbol": "NSE:NIFTY 50-INDEX",
  "analysis": {},
  "volatility": {},
  "timestamp": "2026-03-01T00:00:00.000Z"
}
```

## 8. Watchlist APIs

All watchlist APIs are private.

### 8.1 Get my watchlists

`GET http://localhost:4000/v1/watchlist`  
Authorization: Required

### 8.2 Create watchlist

`POST http://localhost:4000/v1/watchlist`  
Authorization: Required

Body:
```json
{
  "name": "My Watchlist"
}
```

### 8.3 Delete watchlist

`DELETE http://localhost:4000/v1/watchlist/:id`  
Authorization: Required

### 8.4 Add/remove signal in watchlist

`PATCH http://localhost:4000/v1/watchlist/:id/toggle`  
Authorization: Required

Body:
```json
{
  "signalId": "<signal_object_id>"
}
```

## 9. Notification APIs

All notification APIs are private.

### 9.1 My notifications

`GET http://localhost:4000/v1/notifications`

Success:
```json
{
  "results": [],
  "unreadCount": 0
}
```

### 9.2 Register FCM token

`POST http://localhost:4000/v1/notifications/fcm-token`

Body:
```json
{
  "token": "<fcm_device_token>"
}
```

### 9.3 Read all notifications

`PATCH http://localhost:4000/v1/notifications/read-all`  
Success: `204 No Content`

### 9.4 Notification by ID

`GET http://localhost:4000/v1/notifications/:notificationId`

`DELETE http://localhost:4000/v1/notifications/:notificationId`

`PATCH http://localhost:4000/v1/notifications/:notificationId/read`

## 10. Ticket APIs

### 10.1 Create ticket (public)

`POST http://localhost:4000/v1/tickets`  
Authorization: Not required

Body:
```json
{
  "subject": "Need help",
  "ticketType": "SUPPORT",
  "description": "Issue details",
  "contactEmail": "student@example.com",
  "contactNumber": "9876543210"
}
```

Success (201): returns created ticket object.

### 10.2 My tickets (private)

`GET http://localhost:4000/v1/tickets`  
Authorization: Required

### 10.3 Ticket by ID (private)

`GET http://localhost:4000/v1/tickets/:id`  
Authorization: Required

## 11. Dashboard Ticket APIs

### 11.1 Create ticket from dashboard (public)

`POST http://localhost:4000/v1/dashboard/tickets`  
Authorization: Not required

Body same as ticket create.

### 11.2 Get my dashboard tickets (private)

`GET http://localhost:4000/v1/dashboard/tickets`  
Authorization: Required

## 12. Lead API (public onboarding)

### 12.1 Create lead

`POST http://localhost:4000/v1/leads`  
Authorization: Not required  
Content type: `form-data`

Fields:
- `name` (required)
- `email` (required)
- `phone` (required)
- `password` (required)
- `city` (optional)
- `segment` (optional)
- `plan` (optional)
- `verificationToken` (required, from `/auth/verify-otp`)
- `paymentScreenshot` (file, optional)

Success (201): returns lead object.

## 13. Market APIs

### 13.1 Public market data

- `GET http://localhost:4000/v1/market/segments`
- `GET http://localhost:4000/v1/market/symbols?segment=EQUITY&watchlist=true`
- `GET http://localhost:4000/v1/market/history?symbol=NSE:NIFTY%2050-INDEX&resolution=5&from=1700000000&to=1700003600`
- `GET http://localhost:4000/v1/market/search?q=nifty`
- `GET http://localhost:4000/v1/market/login/kite/url`
- `POST http://localhost:4000/v1/market/login/kite`
- `GET http://localhost:4000/v1/market/login/kite`

Authorization: Not required

`POST /market/login/:provider` body example:
```json
{
  "code": "provider_code_or_request_token"
}
```

### 13.2 Private market data

- `GET http://localhost:4000/v1/market/stats`
- `GET http://localhost:4000/v1/market/tickers`
- `GET http://localhost:4000/v1/market/sentiment`
- `GET http://localhost:4000/v1/market/analysis/:symbol`
- `GET http://localhost:4000/v1/market/news/:symbol`

Authorization: Required

## 14. CMS APIs (public)

- `GET http://localhost:4000/v1/cms/pages/:slug`
- `GET http://localhost:4000/v1/cms/faqs`

Authorization: Not required

## 15. Announcement APIs (public read)

- `GET http://localhost:4000/v1/announcements`
- `GET http://localhost:4000/v1/announcements/:announcementId`
- `GET http://localhost:4000/v1/announcements/export`

Authorization: Not required

Useful query params for list/export:
- `status=active|scheduled|history`
- `type=<value>`
- `priority=<value>`
- `page`, `limit`

## 16. Economic Calendar API

`GET http://localhost:4000/v1/economic-calendar`  
Authorization: Required

Optional query:
- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`

## 18. Bot API

`GET http://localhost:4000/v1/bot/status`  
Authorization: Required

Success:
```json
{
  "status": "OFF"
}
```

## 20. Common Error Shape

Many errors come in this format:

```json
{
  "status": "error",
  "statusCode": 401,
  "message": "Please authenticate"
}
```

## 21. Super Quick Postman Flow

1. `POST /v1/auth/register`
2. `POST /v1/auth/send-otp` (email)
3. `POST /v1/auth/verify-otp`
4. `POST /v1/auth/login`
5. Copy login token
6. Add `Authorization: Bearer <token>`
7. **Immediately call** `POST /v1/notifications/fcm-token`
8. Then test other private APIs
