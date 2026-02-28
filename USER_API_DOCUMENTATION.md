# User API Documentation (Postman Ready)

Project: MSPK-Backend  
Base URL: `http://localhost:<PORT>/v1`

## 1. Postman Setup

### Auth Header (for private APIs)
- Key: `Authorization`
- Value: `Bearer <your_jwt_token>`

### Content Types
- JSON APIs: `Content-Type: application/json`
- File upload APIs: `form-data` in Postman

## 1.1 OTP Env Setup (`/auth/send-otp`)

`send-otp` endpoint 2 mode support karta hai:
- `type: "phone"` -> MSG91 SMS OTP
- `type: "email"` -> MSG91 Email OTP + Redis rate-limit/expiry

`.env` mein minimum ye keys add karo:

```env
# App
PORT=5000
FRONTEND_URL=http://localhost:5173

# Redis (email OTP store + cooldown + daily limit)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# MSG91 Core (required for phone/email OTP)
MSG91_AUTH_KEY=your_msg91_auth_key

# Phone OTP template (required for type=phone)
MSG91_OTP_TEMPLATE_ID=your_msg91_sms_otp_template_id

# Email OTP template (required for type=email)
MSG91_EMAIL_TEMPLATE_ID=your_msg91_email_otp_template_id
MSG91_FROM_EMAIL=no-reply@yourdomain.com
MSG91_EMAIL_DOMAIN=yourdomain.com
```

Important:
- `MSG91_AUTH_KEY` missing hua to OTP fail hoga.
- `type=phone` ke liye `MSG91_OTP_TEMPLATE_ID` required hai.
- `type=email` ke liye `MSG91_EMAIL_TEMPLATE_ID`, `MSG91_FROM_EMAIL`, `MSG91_EMAIL_DOMAIN` required hain.
- Redis running hona chahiye, warna email OTP flow ka TTL/daily-limit logic fail ho sakta hai.
- `.env` update ke baad server restart zaroor karo.

---

## 2. Public APIs (No Token Required)

### Auth

#### POST `/auth/register`
- Type: `POST`
- Body (JSON):
```json
{
  "email": "user@example.com",
  "password": "secret123",
  "name": "Demo User",
  "phone": "9876543210",
  "referralCode": "REF123"
}
```

#### POST `/auth/login`
- Type: `POST`
- Body (JSON):
```json
{
  "email": "user@example.com",
  "password": "secret123",
  "deviceId": "device-1",
  "ip": "",
  "sessionId": ""
}
```

#### POST `/auth/send-otp`
- Type: `POST`
- Body (JSON):
```json
{
  "type": "email",
  "identifier": "user@example.com"
}
```
`type` allowed: `phone` or `email`

#### POST `/auth/verify-otp`
- Type: `POST`
- Body (JSON):
```json
{
  "type": "email",
  "identifier": "user@example.com",
  "otp": "123456"
}
```

### Plans / Segments / CMS

#### GET `/plans`
- Type: `GET`
- Query (optional): `role=<value>`
- Body: none

#### GET `/plans/:planId`
- Type: `GET`
- Body: none

#### GET `/segments`
- Type: `GET`
- Body: none

#### GET `/cms/pages/:slug`
- Type: `GET`
- Example: `/cms/pages/contact`
- Body: none

#### GET `/cms/faqs`
j- Type: `GET`
- Body: none

### Announcements

#### GET `/announcements`
- Type: `GET`
- Body: none

#### GET `/announcements/:announcementId`
- Type: `GET`
- Body: none

### Signals (Optional Auth)

#### GET `/signals`
- Type: `GET`
- Body: none

#### GET `/signals/:signalId`
- Type: `GET`
- Body: none

#### GET `/signals/:signalId/analysis`
- Type: `GET`
- Body: none

### Contact / Lead

#### POST `/leads`
- Type: `POST`
- Content-Type: `form-data`
- Body fields:
- `name` (text, required)
- `email` (text, required)
- `phone` (text, required)
- `password` (text, required)
- `city` (text, optional)
- `segment` (text, optional)
- `plan` (text, optional)
- `verificationToken` (text, required; from email OTP verify)
- `paymentScreenshot` (file, optional)

### Tickets (Public Contact Style)

#### POST `/tickets`
- Type: `POST`
- Body (JSON):
```json
{
  "subject": "Need help",
  "ticketType": "SUPPORT",
  "description": "Issue details here",
  "contactEmail": "user@example.com",
  "contactNumber": "9876543210"
}
```

#### POST `/dashboard/tickets`
- Type: `POST`
- Body: same as `/tickets`

### Market (Public)

#### GET `/market/segments`
- Type: `GET`
- Body: none

#### GET `/market/symbols`
- Type: `GET`
- Query (optional):
- `segment=EQUITY`
- `watchlist=true`

#### GET `/market/history`
- Type: `GET`
- Required query:
- `symbol`
- `resolution`
- `from`
- `to`
- Example: `/market/history?symbol=NSE:NIFTY%2050-INDEX&resolution=5&from=1700000000&to=1700003600`

#### GET `/market/search`
- Type: `GET`
- Query: `q=<search_text>`

#### GET `/market/login/:provider/url`
- Type: `GET`
- Example provider: `kite`

#### POST `/market/login/:provider`
- Type: `POST`
- Body (JSON):
```json
{
  "code": "provider_code_or_request_token"
}
```

#### GET `/market/login/:provider`
- Type: `GET`
- Provider callback route

### Utility

#### GET `/health`
- Type: `GET`
- Body: none

---

## 3. Private User APIs (Token Required)

### Auth Profile

#### GET `/auth/me`
- Type: `GET`
- Body: none

#### PATCH `/auth/me`
- Type: `PATCH`
- Content-Type: `form-data` (if avatar upload), otherwise JSON
- Allowed body fields:
```json
{
  "name": "New Name",
  "phone": "9999999999",
  "profile": {
    "avatar": "https://example.com/a.jpg",
    "address": "Street 1",
    "city": "Mumbai",
    "state": "MH"
  }
}
```
- File key for upload: `avatar`

#### POST `/auth/change-password`
- Type: `POST`
- Body (JSON):
```json
{
  "oldPassword": "secret123",
  "newPassword": "newsecret123",
  "confirmNewPassword": "newsecret123"
}
```

#### POST `/auth/logout`
- Type: `POST`
- Body: none

### Subscription

#### POST `/subscribe/purchase`
- Type: `POST`
- Body (JSON):
```json
{
  "segments": ["EQUITY", "FNO"],
  "planType": "premium"
}
```

#### GET `/subscribe/status`
- Type: `GET`
- Body: none

#### GET `/subscribe/has-access/:segment`
- Type: `GET`
- Example: `/subscribe/has-access/EQUITY`
- Body: none

### Payments

#### GET `/payments/details`
- Type: `GET`
- Body: none

#### POST `/payments/verify-payment`
- Type: `POST`
- Content-Type: `form-data`
- Body fields:
- `segmentCodes` (text; JSON string like `["EQUITY","OPTIONS"]`)
- `transactionId` (text)
- `screenshot` (file, required)

### Notifications

#### GET `/notifications`
- Type: `GET`
- Body: none

#### POST `/notifications/fcm-token`
- Type: `POST`
- Body (JSON):
```json
{
  "token": "fcm_device_token"
}
```

#### PATCH `/notifications/read-all`
- Type: `PATCH`
- Body: none

#### GET `/notifications/:notificationId`
- Type: `GET`
- Body: none

#### DELETE `/notifications/:notificationId`
- Type: `DELETE`
- Body: none

#### PATCH `/notifications/:notificationId/read`
- Type: `PATCH`
- Body: none

### Watchlist

#### GET `/watchlist`
- Type: `GET`
- Body: none

#### POST `/watchlist`
- Type: `POST`
- Body (JSON):
```json
{
  "name": "My Watchlist"
}
```

#### DELETE `/watchlist/:id`
- Type: `DELETE`
- Body: none

#### PATCH `/watchlist/:id/toggle`
- Type: `PATCH`
- Body (JSON):
```json
{
  "signalId": "<signal_object_id>"
}
```

### Tickets

#### GET `/tickets`
- Type: `GET`
- Body: none

#### GET `/tickets/:id`
- Type: `GET`
- Body: none

#### GET `/dashboard/tickets`
- Type: `GET`
- Body: none

### Market (Private Endpoints)

#### GET `/market/stats`
- Type: `GET`
- Body: none

#### GET `/market/tickers`
- Type: `GET`
- Body: none

#### GET `/market/sentiment`
- Type: `GET`
- Body: none

#### GET `/market/analysis/:symbol`
- Type: `GET`
- Example: `/market/analysis/NSE:NIFTY%2050-INDEX`

#### GET `/market/news/:symbol`
- Type: `GET`
- Example: `/market/news/AAPL`

### Other User APIs

#### GET `/economic-calendar`
- Type: `GET`
- Query (optional):
- `from=YYYY-MM-DD`
- `to=YYYY-MM-DD`

#### GET `/bot/status`
- Type: `GET`
- Body: none

#### GET `/search`
- Type: `GET`
- Query: `q=<min_2_chars>`

### Strategies (Authenticated)

#### GET `/strategies`
- Type: `GET`
- Body: none

#### POST `/strategies`
- Type: `POST`
- Body (minimum JSON):
```json
{
  "name": "RSI Reversal",
  "symbol": "NSE:NIFTY 50-INDEX",
  "timeframe": "5m",
  "segment": "EQUITY"
}
```

#### PATCH `/strategies/:strategyId`
- Type: `PATCH`
- Body: fields you want to update

#### DELETE `/strategies/:strategyId`
- Type: `DELETE`
- Body: none

#### POST `/strategies/seed`
- Type: `POST`
- Body: none

---

## 4. Quick Postman Flow (Recommended)
1. Call `POST /v1/auth/login` and copy token.
2. In Postman Collection Authorization, set Bearer token.
3. Test private APIs (`/auth/me`, `/subscribe/status`, `/notifications`, etc.).
4. For file upload APIs, use `form-data` (not raw JSON).

---

## 5. Important Notes
- Admin-only APIs are intentionally excluded from this user file.
- Some APIs support both public and private behavior (for example signals with optional auth).
- Ticket create is public now: `/v1/tickets` and `/v1/dashboard/tickets`.
