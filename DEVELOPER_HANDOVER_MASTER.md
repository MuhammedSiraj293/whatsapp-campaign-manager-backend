# Master Developer Handover Document & System Architecture Manual

**Project**: WhatsApp Business API Marketing, Automation & Multi-Agent CRM Platform  
**Client / Brand**: The Capital Avenue Real Estate  
**Author / Departing Engineer**: Lead Full-Stack WhatsApp Automation Engineer  
**Handover Date**: October 2026  
**Status**: Production Ready & Fully Documented  

---

## 1. Executive Summary & Purpose of Handover

This document serves as the official, comprehensive technical handover manual for the incoming development and engineering team. It describes the entire architecture, design patterns, end-to-end operational pipelines, deployment topologies, database schemas, third-party integrations, and troubleshooting playbooks across both the **Backend** and **Frontend** repositories.

### What is this System?
An enterprise-grade, multi-tenant WhatsApp Business API platform that unifies:
1. **Bulk Marketing & Targeted Campaigns**: Batching, rate-limiting, deduplication, exclusions, and pause/resume mechanisms.
2. **Real-Time Live Chat Concierge**: Bi-directional messaging, media downloads, reactions, unread counters, and Socket.IO real-time synchronization.
3. **Visual Automation Flow Builder**: Node-based decision trees with ReactFlow, auto-layout (Dagre), and dynamic branching.
4. **Multi-Tenant Access Control**: Role-based access control (Admin, Manager, Viewer) with granular isolation of WABA accounts, Meta phone lines, and contact segments.
5. **Background Automation & Scheduling**: Automated schedulers for scheduled campaigns and conversation inactivity session cleanups.

---

## 2. High-Level Architecture & End-to-End Topology

```
                              ┌───────────────────────────────────────────────┐
                              │           Meta WhatsApp Cloud API             │
                              │           (Graph API v20.0 Webhooks)          │
                              └───────────────────────┬───────────────────────┘
                                                      │ (Encrypted HTTPS)
                                                      ▼
 ┌───────────────────────────┐             ┌─────────────────────────────────────┐
 │    Customer on WhatsApp   │◄───────────►│       Backend (Express / Node)      │
 │ (Text, Voice, Image, URL) │             │  Port: 5001 / 10000                 │
 └───────────────────────────┘             └──────┬───────────────────────┬──────┘
                                                  │                       │
                         Socket.IO (WebSockets)   │                       │ Mongoose Driver
                       (newMessage, statusUpdate) │                       │ (AES-256-CBC)
                                                  ▼                       ▼
                                       ┌────────────────────┐   ┌─────────────────┐
                                       │ React 18 Dashboard │   │  MongoDB Atlas  │
                                       │ (Tailwind / Flow)  │   │   (ReplicaSet)  │
                                       └────────────────────┘   └─────────────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────┐
                                       │  External Services │
                                       │ - Cloudinary CDN   │
                                       │ - Meta CDN         │
                                       │ - Gmail SMTP (2FA) │
                                       └────────────────────┘
```

---

## 3. Directory & Repository Map

```
Whatsapp Business API with  flow/
│
├── backend/                               # Express REST API, Sockets & Schedulers
│   ├── .env                               # Environment configurations & keys
│   ├── check_statuses.js                  # Diagnostic CLI script for campaign statuses
│   ├── DEVELOPER_ANNOTATIONS.md           # Deep-dive backend functions & architecture
│   ├── uploads/                           # Local temporary upload cache
│   └── src/
│       ├── server.js                      # Express bootstrap, CORS, HTTP & Socket.IO server
│       ├── socketManager.js               # WebSocket singleton instance manager
│       ├── config/
│       │   └── db.js                      # MongoDB connection handler
│       ├── controllers/                   # 17 Express controllers (REST handlers)
│       ├── integrations/
│       │   ├── whatsappAPI.js             # Meta Cloud Graph API v20.0 client
│       │   └── cloudinary.js              # Media storage integration
│       ├── jobs/
│       │   └── scheduler.js               # Node-cron background worker (1-minute intervals)
│       ├── middleware/
│       │   ├── authMiddleware.js          # JWT verification & RBAC authorization
│       │   └── webhookHandler.js          # Webhook ingestion, debounce buffer & router
│       ├── models/                        # 16 Mongoose Schemas (Data layer)
│       ├── routes/                        # 16 Express route definitions
│       ├── services/
│       │   ├── campaignService.js         # Batch campaign worker & state manager
│       │   ├── botService.js              # State-machine rule bot executor
│       │   └── botFlow.js                 # Fallback interactive bot flow templates
│       └── utils/
│           ├── accessControl.js           # Multi-tenant data isolation & permission guards
│           └── encryption.js              # AES-256-CBC token cryptographer
│
├── frontend/                              # React Single-Page Application (CRA)
│   ├── public/
│   │   ├── index.html                     # HTML5 shell with local branded favicons
│   │   ├── favicon.png / favicon.ico      # High-res gold emblem icons
│   │   └── logo192.png / logo512.png      # PWA app icons
│   └── src/
│       ├── App.js                         # React Router v6 & ProtectedRoute definitions
│       ├── config.js                      # Dynamic API_URL configuration
│       ├── index.js                       # React 18 DOM mount point & context providers
│       ├── assets/                        # SVG icons, company logos, chat backgrounds
│       ├── context/
│       │   ├── AuthContext.js             # User login, JWT token & role management
│       │   ├── WabaContext.js             # Active WABA tenant switcher & persistence
│       │   └── AlertContext.js            # Global toast notifications & alert override
│       ├── services/
│       │   ├── api.js                     # Authenticated fetch & uploadFile wrapper
│       │   └── socket.js                  # Socket.IO client connection instance
│       ├── components/                    # 18 Reusable UI components
│       └── pages/                         # 20 View pages (CRM, Analytics, Chat, Flow)
│
├── FRONTEND_DEVELOPER_ANNOTATIONS.md      # Detailed React component & page reference
└── DEVELOPER_HANDOVER_MASTER.md           # This master document
```

---

## 4. Key Workflows & Operational Mechanics

### 4.1 Inbound WhatsApp Webhook Ingestion
1. **Entry Point**: Meta sends an HTTP POST request to `/api/webhook` which invokes `processWebhook` in `backend/src/middleware/webhookHandler.js`.
2. **Debouncing Strategy (2000ms Buffer)**:
   - Users frequently send multiple short messages in rapid succession (e.g., *"Hello"* $\to$ *"I want 2 bedrooms"* $\to$ *"on Saadiyat Island"* within 3 seconds).
   - The server places each message into an in-memory queue (`userMessageBuffer`) keyed by phone number and resets a 2000ms timer.
   - Once the user pauses typing, `processBufferedMessages` bundles all text into one concatenated prompt.
3. **Processing Priority Hierarchy**:
   - **Priority 0 (Property Link Interceptor)**: If the message contains a `thecapitalavenue.com` property link, it starts/completes a structured 2-step `PropertyInquirySession` (capturing Name and Bedrooms).
   - **Priority 1 (Campaign Attribution)**: Direct context replies, 7-day keyword lookbacks (*"Yes, I am interested"*), or 16-hour implicit windows link the inbound message to its originating marketing campaign.
   - **Priority 2 (Stop / Unsubscribe Survey)**: If the user says *"Stop"*, an interactive reason list is sent (Too many messages, Not relevant, Already purchased, Other). Selecting a reason unsubscribes them, marks them as `Dead`, and logs the reason.
   - **Priority 3 (Bot Flow Engine)**: Dispatches to the state machine and flow automation in `botService.js` to handle interactive branching, custom nodes, and customer conversations.
4. **Delivery & Status Tracking**:
   - Meta status callbacks (`sent`, `delivered`, `read`, `failed`) update `Analytics` records.
   - If Meta returns error `131026` (recipient has no WhatsApp account), the contact is immediately marked `isSubscribed: false` and `computedStatus: "Dead"` to prevent wasted spend.
   - Updates are broadcasted via Socket.IO `io.emit("messageStatusUpdate", ...)`.

### 4.2 Marketing Campaign Dispatch Engine
1. **Initiation**: A campaign can be triggered immediately via `POST /api/campaigns/:id/send` or picked up automatically by `scheduler.js` when `scheduledFor <= now`.
2. **Background Execution**: `campaignService.js` marks the campaign as `"sending"` and executes `processCampaignBackground()` asynchronously without blocking HTTP response threads.
3. **Deduplication & Exclusions**:
   - Compiles numbers in the `exclusionList`.
   - Queries `Analytics` to find any numbers that already received this exact template from *any* prior campaign (where status $\ne$ `"failed"`).
   - Excludes contacts with `computedStatus: "Dead"`.
   - Records skipped contacts in `Analytics` with status `"skipped"` and deterministic WAMID (`skipped_<campaignId>_<contactId>`).
4. **Rate-Limiting & Batching**:
   - Iterates in batches (default: 50 contacts) with a configurable `batchDelay` (default: 2 minutes) between batches and `messageDelay` (default: 2000ms) between individual messages to stay within Meta's rate limits.
   - Checks the in-memory `campaignStateMap` between every message and batch to support instant **Pause** and **Resume**.
5. **Real-Time Notification**: Emits `campaignsUpdated` and `newMessage` over Socket.IO so dashboards update live.

### 4.3 Automated Background Schedulers
Located in `backend/src/jobs/scheduler.js`, running on a 1-minute cron interval:
1. **Scheduled Campaign Worker**: Searches for campaigns where `status: "scheduled"` and `scheduledFor <= new Date()`.
2. **Inactivity Session Closer**: Finds active conversations untouched for $\ge 15$ minutes and marks `conversationState = "END"` with `endedAt = new Date()`.

---

## 5. Security & Multi-Tenant Access Control

### 5.1 Role Hierarchy & Permissions
The system supports three user roles defined in `backend/src/models/User.js`:
- **`admin`**: Unrestricted access across all WABA accounts, phone lines, contact lists, campaigns, user management, and system integrations.
- **`manager`**: Access restricted to assigned WABA accounts (`assignedWabas`) and assigned contact lists (`assignedContactLists`). Can create campaigns, edit contacts, and manage chats.
- **`viewer`**: Read-only access to assigned WABAs. Limited to viewing conversations, enquiries, and responding in live chat. Blocked from administrative settings, billing, user management, and campaign creation.

### 5.2 Token Cryptography at Rest
- Sensitive permanent Meta Access Tokens (`WabaAccount.accessToken`) are encrypted at rest using AES-256-CBC via `backend/src/utils/encryption.js`.
- An initialization vector (IV) of 16 random bytes is prepended to the ciphertext (`iv:ciphertext`).
- Mongoose schema getters and setters handle transparent encryption on write and decryption on read.

### 5.3 Two-Factor Authentication (2FA)
- Implemented via TOTP (Time-based One-Time Password) using `speakeasy` and `qrcode` in `twoFactorController.js`.
- If `user.isTwoFactorEnabled === true`, login requires both password and the 6-digit authenticator code.

---

## 6. Environment Configuration (.env) Reference

| Variable Name | Description | Example / Location |
|---|---|---|
| `PORT` | Backend listening port | `5001` or `10000` |
| `MONGO_URI` | MongoDB Atlas ReplicaSet connection string | `mongodb://.../whatsapp-campaigns?ssl=true` |
| `ENCRYPTION_KEY` | Secret key for AES-256-CBC token encryption | 32-character string |
| `JWT_SECRET` | Secret key for signing JSON Web Tokens | Alphanumeric string |
| `JWT_EXPIRE` | Token validity duration | `30d` |
| `WHATSAPP_ACCESS_TOKEN` | Default Meta system access token | `EAAc718...` |
| `WHATSAPP_PHONE_NUMBER_ID`| Default Meta phone number ID | `12345678909876` |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Default WABA account ID | `1234567892345` |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification challenge token | `qefeqfeqf` |
| `CLOUDINARY_*` | Cloudinary credentials for media hosting | `grggqgqeg`, API key & secret |
| `SMTP_*` | Gmail SMTP credentials for 2FA emails | `smtp.gmail.com`, port `587`, App Password |
| `REACT_APP_API_URL` | Frontend URL pointer to backend API | `http://localhost:5001` or production domain |

---

## 7. Deployment, Startup & Maintenance Playbook

### 7.1 Local Development Startup
1. **Backend**:
   ```powershell
   cd "d:\Whatsapp Business API with  flow\backend"
   npm install
   npm start
   # Server runs on http://localhost:5001
   ```
2. **Frontend**:
   ```powershell
   cd "d:\Whatsapp Business API with  flow\frontend"
   npm install
   npm start
   # Client runs on http://localhost:3000
   ```

### 7.2 Production Build & Deployment
- The backend serves the compiled frontend bundle automatically from `frontend/build` via Express static middleware.
- When updating frontend code, run:
  ```powershell
  cd "d:\Whatsapp Business API with  flow\frontend"
  npm run build
  ```
- Restart the backend Node process (PM2, Docker, or Render/Cloud server) to load the new build.

### 7.3 Critical Operational Gotchas & Troubleshooting

1. **Meta Webhook URL Requirements**:
   - Meta requires an HTTPS endpoint with a valid SSL certificate. In local dev, use an Ngrok or Cloudflare tunnel pointing to `http://localhost:5001/api/webhook`.
   - Webhook verify token in Meta Developer Portal must match `WHATSAPP_VERIFY_TOKEN`.

2. **Template Synchronization**:
   - Meta templates must be approved before they can be sent.
   - When a template is edited or created via the Template Manager, `clearTemplateCache()` invalidates the backend cache so the latest components and variables are pulled fresh from Meta.

3. **Database Indexing & Thread Safety**:
   - `updateContactStats` uses atomic MongoDB operations (`findOneAndUpdate` with `$inc`) to prevent race conditions during heavy incoming webhook bursts.
   - The `Analytics` collection has compound indexes on `{ wamid: 1 }`, `{ campaign: 1, status: 1 }`, and `{ contact: 1, status: 1 }` for instant aggregation queries.

4. **Hotlink Protection & Media Hosting**:
   - Do **not** use direct external hotlinks from client corporate websites for UI assets (favicons, logos). Always store local vector or image assets in `frontend/src/assets/images/` and `frontend/public/` to prevent CORS and hotlink blocking.

---

## 8. Developer Document Index

For granular, file-by-file developer annotations:
- **Backend Deep Dive**: [`backend/DEVELOPER_ANNOTATIONS.md`](file:///c:/Users/TCA/Desktop/HANDOVER%20SIRAJ/Whatsapp-api/backend/DEVELOPER_ANNOTATIONS.md) — Function signatures, query pipelines, Mongoose models, and crypto utilities.
- **Frontend Deep Dive**: [`frontend/FRONTEND_DEVELOPER_ANNOTATIONS.md`](file:///c:/Users/TCA/Desktop/HANDOVER%20SIRAJ/Whatsapp-api/frontend/FRONTEND_DEVELOPER_ANNOTATIONS.md) — React pages, components, context state managers, flow builder architecture, and WebSocket hooks.
- **Hosting, Accounts & Deployment Guide**: [`PLATFORM_HOSTING_AND_ACCESS_GUIDE.md`](file:///c:/Users/TCA/Desktop/HANDOVER%20SIRAJ/Whatsapp-api/PLATFORM_HOSTING_AND_ACCESS_GUIDE.md) — Complete guide on hosting on Vercel, Render, MongoDB Atlas, Cloudinary, access tokens, and step-by-step setup in a new environment.
