# WhatsApp Business API Platform - Backend Developer Annotations & Architecture Note

This document serves as the comprehensive technical reference for developers working on the backend codebase. It details **what functions exist**, **how they work under the hood**, and **why they are designed this way**.

---

## Table of Contents

1. [System Architecture & Data Flow](#1-system-architecture--data-flow)
2. [Server Bootstrapping & Global Infrastructure](#2-server-bootstrapping--global-infrastructure)
3. [Security, Cryptography & Access Control](#3-security-cryptography--access-control)
4. [Meta WhatsApp API Integration Layer](#4-meta-whatsapp-api-integration-layer)
5. [Webhook Ingestion & Real-Time Event Pipeline](#5-webhook-ingestion--real-time-event-pipeline)
6. [Campaign Orchestration & Background Worker](#6-campaign-orchestration--background-worker)
7. [Automated Schedulers, Follow-Ups & Review System](#7-automated-schedulers-follow-ups--review-system)
8. [Conversational AI & Bot Automation Service](#8-conversational-ai--bot-automation-service)
9. [Controllers & API Endpoint Reference](#9-controllers--api-endpoint-reference)
10. [Mongoose Data Models & Database Schemas](#10-mongoose-data-models--database-schemas)

---

## 1. System Architecture & Data Flow

```
   [ Meta Cloud Graph API ] <────────── Webhook POST (v20.0) ──────────┐
              │                                                         │
              ▼                                                         ▼
    [ webhookHandler.js ]                                  [ Express HTTP Server ]
   (Debouncing, Lead Routing,                                (REST APIs & CORS)
    AI Dispatch, Status Sync)                                           │
              │                                                         ▼
              ├────── Socket.IO Event Emissions ──────► [ Frontend React Dashboard ]
              │     ('newMessage', 'campaignsUpdated',                  │
              │      'messageStatusUpdate')                             │
              ▼                                                         ▼
   [ Services Layer ]                                      [ MongoDB Collections ]
  - campaignService.js (Batching/Deduplication)           - Contacts & ContactLists
  - followUpScheduler.js (Inactivity & Reviews)          - Campaigns & Analytics
  - aiService.js (Gemini 2.0 Flash)                       - Enquiries & Replies
  - whatsappAPI.js (Axios HTTP Client)                    - WabaAccounts & PhoneNumbers
```

---

## 2. Server Bootstrapping & Global Infrastructure

### 2.1 `src/server.js`

- **Purpose**: Initializes Express application, connects to MongoDB, starts the HTTP server, mounts Socket.IO with CORS, registers 15+ API route modules, serves static assets (uploads & frontend build), and triggers background cron jobs.
- **Key Functions / Blocks**:
  - `dotenv.config()`: Loads environment variables before any module reads secrets.
  - `connectDB()`: Connects to MongoDB Atlas cluster using Mongoose.
  - `cors(corsOptions)`: Restricts cross-origin requests to trusted origins (`localhost:3000`, Vite `5173`, Vercel production and preview deployments, and Render).
  - `socketManager.init(httpServer, corsOptions)`: Initializes WebSocket engine bound to the same port.
  - `startScheduler()`: Starts background cron routines (campaign scheduler, inactivity watcher, follow-up loop).
  - `express.static(path.join(__dirname, "../uploads"))`: Exposes locally stored media files.
  - `app.get("*splat", ...)`: Single-Page Application (SPA) catch-all handler for React client-side routing.

### 2.2 `src/socketManager.js`

- **Purpose**: Implements a Singleton pattern for Socket.IO to enable WebSocket broadcasting from any controller, service, or background job without circular dependencies.
- **Functions**:
  - `init(httpServer, corsOptions)`:
    - _How_: Binds a new `Server(httpServer, { cors })` and caches it in a module-level variable `io`.
    - _Why_: Decouples Socket.IO lifecycle from HTTP route definitions.
  - `getIO()`:
    - _How_: Returns the active `io` instance or throws an explicit error if accessed prematurely.
    - _Why_: Guarantees that any service emitting events (`newMessage`, `campaignsUpdated`, `messageStatusUpdate`) gets a valid WebSocket instance.

---

## 3. Security, Cryptography & Access Control

### 3.1 `src/utils/encryption.js`

- **Purpose**: Provides symmetric encryption and decryption for sensitive Meta permanent Access Tokens stored in MongoDB.
- **Algorithm**: `AES-256-CBC` with 16-byte random IV and SHA-256 digested key derived from `ENCRYPTION_KEY`.
- **Functions**:
  - `encrypt(text)`:
    - _How_: Generates `crypto.randomBytes(16)`, creates cipher, encrypts plaintext, and returns `${iv_hex}:${cipher_hex}`. If already encrypted (contains `:`), returns string as-is.
    - _Why_: Encrypts tokens at rest to comply with enterprise data security guidelines.
  - `decrypt(text)`:
    - _How_: Splits string by `:`, parses IV, creates decipher, and decrypts back to utf8 plaintext. If string does not contain `:`, returns as-is (graceful fallback for unencrypted legacy tokens).
    - _Why_: Mongoose getters on `WabaAccount.accessToken` automatically decrypt tokens on database read.

### 3.2 `src/utils/accessControl.js`

- **Purpose**: Implements strict Role-Based Access Control (RBAC) and data isolation between users (Admins vs. Team Members/Viewers).
- **Functions**:
  - `getAssignedWabaIds(user)`: Returns `null` if user is Admin (no restrictions), or an array of allowed `WabaAccount` ObjectIds.
  - `getAssignedPhoneNumberIds(user)`: Resolves Meta Phone Number ID strings (`phoneNumberId`) belonging to the user's assigned WABA accounts.
  - `getContactListFilter(user)`: Builds a MongoDB filter query: Admins get `{}` (all lists); regular users get `$or: [{ _id: { $in: assigned } }, { createdBy: user._id }]`.
  - `getAssignedContactListIds(user)`: Resolves contact list IDs the user can see.
  - `verifyWabaAccess(user, wabaId)`: Throws HTTP 403 error if a non-admin attempts to query or manipulate a WABA they do not own.
  - `verifyPhoneNumberAccess(user, phoneNumberId)`: Throws HTTP 403 error if a user lacks access to the given business phone number.
  - `verifyContactListAccess(user, listId)`: Verifies if user can view contacts in a list.
  - `verifyContactMutationAccess(user, contact)`: Prevents team members from editing or deleting contacts created by another user or belonging to lists they don't own.

### 3.3 `src/middleware/authMiddleware.js`

- **Functions**:
  - `protect(req, res, next)`: Extracts `Bearer <token>` from HTTP `Authorization` header, verifies signature using `process.env.JWT_SECRET`, retrieves the user document from MongoDB (excluding password), and attaches it to `req.user`. Returns 401 on token failure.
  - `authorize(...roles)`: Route guard middleware checking if `roles.includes(req.user.role)`. Returns 403 if unauthorized.

---

## 4. Meta WhatsApp API Integration Layer

### `src/integrations/whatsappAPI.js`

All interactions with Meta Cloud API (`graph.facebook.com/v20.0`) are centralized here.

| Function              | Arguments                                                               | How It Works                                                                                                                                  | Why It Exists                                                                                                    |
| --------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sendTextMessage`     | `(to, text, accessToken, phoneNumberId, contextMessageId)`              | Sends HTTP POST to `/{phoneNumberId}/messages` with `type: "text"`. Optional `context.message_id` quotes a previous message.                  | Primary channel for standard agent & bot responses.                                                              |
| `sendReactionMessage` | `(to, messageId, emoji, accessToken, phoneNumberId)`                    | Sends `type: "reaction"` with target `message_id` and emoji character.                                                                        | Allows staff or bot to add emoji reactions to incoming messages in real time.                                    |
| `sendButtonMessage`   | `(to, text, buttons, accessToken, phoneNumberId)`                       | Formats payload as `type: "interactive"`, `interactive.type: "button"`. Limits buttons to 3 (Meta limit) and button titles to $\le 20$ chars. | Used for quick replies, follow-up actions ("Continue" / "End Chat"), and interactive decisions.                  |
| `sendListMessage`     | `(to, text, buttonText, sections, accessToken, phoneNumberId)`          | Formats payload as `interactive.type: "list"` with custom sections and rows.                                                                  | Used for multi-option surveys (e.g., Unsubscribe reason survey, 1-5 Star rating list).                           |
| `sendMediaMessage`    | `(to, mediaType, mediaIdOrUrl, caption, accessToken, phoneNumberId)`    | Supports `image`, `video`, `audio`, `document`. Uses Meta media ID if available, otherwise external URL.                                      | Sends brochures, property images, and voice notes.                                                               |
| `uploadMedia`         | `(file, accessToken, phoneNumberId)`                                    | Constructs `multipart/form-data` stream to `/{phoneNumberId}/media`. Deletes local file upon completion.                                      | Obtains Meta media ID (`wamid`) for sending media without hosting bandwidth bottlenecks.                         |
| `getMediaUrl`         | `(mediaId, accessToken)`                                                | Calls `GET /{mediaId}` to fetch temporary binary download URL from Meta CDN.                                                                  | Required first step to download customer images/audio received via webhook.                                      |
| `sendTemplateMessage` | `(to, templateName, languageCode, options, accessToken, phoneNumberId)` | Builds template payload, formats headers (Media ID or URL), body variables (`{{1}}`, `{{2}}`), and buttons.                                   | Required by Meta for initiating conversations or sending marketing campaigns outside the 24-hour service window. |
| `clearTemplateCache`  | `(templateName)`                                                        | Clears in-memory template schema cache.                                                                                                       | Invalidates cached template structures when templates are edited or when campaigns start.                        |

---

## 5. Webhook Ingestion & Real-Time Event Pipeline

### `src/middleware/webhookHandler.js` (Core Ingestion Engine)

The webhook handler handles all real-time bidirectional traffic from Meta.

#### Key Functions & Mechanisms:

1. **`verifyWebhook(req, res)`**:
   - Responds to Meta verification GET requests containing `hub.mode`, `hub.verify_token`, and `hub.challenge`.
   - Validates `hub.verify_token === process.env.WHATSAPP_VERIFY_TOKEN` and echoes `hub.challenge`.

2. **`updateContactStats(identifier, type, status, isBsuid)`**:
   - **How**: Executes thread-safe atomic `$inc` updates on `Contact.stats` (`sent`, `delivered`, `read`, `failed`, `replied`).
   - **Score Formula**:
     $$\text{Score} = (\text{ReadRate} \times 0.4) + (\text{ReplyRate} \times 0.6)$$
   - **Dynamic Status Categorization**:
     - `Dead`: Unsubscribed, failed $\ge 6$, or sent $\ge 10$ with 0 replies.
     - `Engaged`: Replied $> 0$ and active within last 30 days.
     - `Unresponsive`: Messages sent $> 0$, but no recent reply.
     - `New`: Newly added contact with no send history.
   - **Why**: Eliminates manual database maintenance and gives instant contact health visibility.

3. **`handlePropertyInquiryFlow(userPhone, recipientId, messageBody, credentials, io)`**:
   - **How**: Scans incoming text for `thecapitalavenue.com` property links.
   - **Step 1**: Parses URL slug using `extractPropertyName()`, creates `PropertyInquirySession` (`awaiting_details`), and sends structured questionnaire:
     _"Please share details: Name & No. Of Bedrooms"_.
   - **Step 2**: When the customer responds to the form, completes session, creates an `Enquiry` in CRM, and delivers confirmation.
   - **Why**: Guarantees zero response delay for website leads without consuming unnecessary AI tokens.

4. **`processBufferedMessages(recipientId, userPhone, credentials, phoneNumberDoc)` (Debounce Aggregator)**:
   - **Problem**: WhatsApp users frequently send multiple fragmented messages in rapid succession (e.g., _"Hi"_ $\to$ _"I want 2 bed"_ $\to$ _"in Yas Island"_ within 3 seconds). Running AI independently on each fragment causes disjointed, competing replies.
   - **Solution**: Implements a 2000ms debounce timer (`userMessageBuffer`). Successive messages reset the timer and append to the buffer.
   - **Processing**:
     - Joins fragmented text into a single cohesive context: `combinedBody = textMessages.map(m => m.body).join(". ")`.
     - Checks if batch contains campaign attribution.
     - Dispatches through business logic sequence:
       1. Property Inquiry Interceptor.
       2. Campaign Reply / Lead Routing.
       3. Stop / Unsubscribe Survey & Opt-out logic.
       4. AI Agent Dispatch (`generateResponse`).
       5. Legacy Decision-Tree Bot Fallback.

5. **Campaign Lead Attribution**:
   - **Primary**: Quoted message context (`message.context.id` mapped to `Analytics.wamid`).
   - **Secondary (Keyword Lookback)**: If message contains keywords like _"Yes, I am interested"_ or _"نعم، مهتم"_, performs a 7-day lookback in `Analytics` to link to the last received campaign.
   - **Tertiary (Implicit)**: Checks if a campaign was delivered to this contact within the last 16 hours.

6. **Message Status Updates (`statuses` array)**:
   - Updates `Analytics` document status to `sent`, `delivered`, `read`, or `failed`.
   - **Error 131026 Handling**: When Meta reports error `131026` (Undeliverable / No WhatsApp account), automatically marks the `Contact` as `isSubscribed: false` and `computedStatus: "Dead"`, preventing future campaign waste.
   - Emits `messageStatusUpdate` to frontend over Socket.IO.

---

## 6. Campaign Orchestration & Background Worker

### 6.1 `src/services/campaignService.js`

- **Purpose**: High-throughput, rate-limited, resilient batch sending engine for WhatsApp campaigns.

#### Key Functions:

- **`sendCampaign(campaignId, options)`**:
  - Launches `processCampaignBackground()` asynchronously (fire-and-forget pattern) so API requests return immediately without HTTP timeouts.
- **`pauseCampaign(campaignId)` / `resumeCampaign(campaignId)` / `getCampaignState(campaignId)`**:
  - Uses an in-memory `Map<string, 'running' | 'paused' | 'stopped'>` to pause and resume sending between batches or even between individual messages.
- **`waitWhilePaused(campaignId)`**:
  - Polls state every 2000ms until the campaign is resumed.
- **`processCampaignBackground(campaignId, options)`**:
  - **Batching Parameters**: `batchSize` (default: 50), `batchDelay` (default: 2000ms), `messageDelay` (default: 2000ms).
  - **Exclusion Filters**:
    - Automatically excludes `computedStatus: "Dead"` contacts (unless explicitly requested).
    - Excludes contacts in the selected `exclusionList`.
  - **Strict Deduplication**:
    - Queries `Analytics` to find phone numbers that already received this template from _any_ campaign (status $\ne$ `"failed"`).
    - Prevents duplicate sends even on server restarts or manual resumes.
  - **Skipped Contacts Tracking**:
    - Inserts records in `Analytics` with deterministic WAMID: `skipped_<campaignId>_<contactId>` and status `"skipped"`.
  - **Batch Loop**:
    - Queries contacts using `.skip(offset).limit(batchSize)`.
    - Iterates sequentially with `messageDelay` to respect Meta API rate limits.
    - Saves outgoing chat history to `Reply` model.
    - Emits `campaignsUpdated` and `newMessage` over Socket.IO.

---

## 7. Automated Schedulers, Follow-Ups & Review System

### 7.1 `src/jobs/scheduler.js`

- **Purpose**: Cron orchestrator managing background periodic jobs using `node-cron`.
- **Routines**:
  - `* * * * *` (Every 1 Minute): **Scheduled Campaign Picker**
    - Finds campaigns with `status: "scheduled"` and `scheduledFor <= now`.
    - Updates status to `"sending"` and calls `sendCampaign()`.
  - `* * * * *` (Every 1 Minute): **Inactivity Auto-Closer**
    - Queries active enquiries (`conversationState != "END"`) untouched for $> 15$ minutes.
    - Sets `conversationState = "END"` and `endedAt = now`.
  - `* * * * *` (Every 1 Minute): **Smart Follow-Up Engine**
    - Calls `checkAndSendFollowUps()`.

### 7.2 `src/services/followUpScheduler.js`

- **Purpose**: Intelligent client engagement engine that recovers stalled conversations and captures customer satisfaction ratings.

#### Flow Phases:

1. **Pre-Check Optimization**:
   - Queries `PhoneNumber` documents where `isFollowUpEnabled === true` or `isReviewEnabled === true`. If no active lines have these toggles enabled, skips database queries entirely.
2. **Phase 1: Stuck Enquiry Follow-Up (3 Minutes Inactivity)**:
   - Detects active enquiries inactive for $> 3$ minutes.
   - Enforces a **maximum of 1 follow-up per 24 hours** (`lastStuckFollowUpSentAt`).
   - Sends bilingual interactive button message:
     - English: _"Apologies, I didn't get a response from you! Please complete your enquiry..."_
     - Buttons: `[ Continue ]` | `[ End Chat ]`
3. **Phase 1.5: Timeout Auto-Close (10 Minutes Post-Stuck Message)**:
   - If user receives the stuck message and remains silent for another 10 minutes, closes the conversation courteously and sets `completionFollowUpSent = true` to prevent review prompts.
4. **Phase 2: Review Request (1 Minute Post-Completion)**:
   - For conversations that completed successfully (`conversationState === "END"`), waits 60 seconds and sends an interactive 5-star rating list message:
     - ⭐⭐⭐⭐⭐ Excellent
     - ⭐⭐⭐⭐ Good
     - ⭐⭐⭐ Average
     - ⭐⭐ Poor
     - ⭐ Very Poor
   - Stores review response in `Enquiry.reviewStatus` and `Enquiry.reviewRating`.

---

## 8. Conversational AI & Bot Automation Service

### 8.1 `src/services/aiService.js` (Google Gemini 2.0 Flash)

- **Purpose**: Conversational real estate concierge for Capital Avenue.
- **Key Function**:
  - `generateResponse(userPhone, messageBody, existingEnquiry, effectiveName)`:
    - **Language Mirroring**: Automatically responds in Arabic if the user writes in Arabic; otherwise English.
    - **Natural Chat Pacing (`|||`)**: AI outputs up to 3 bubbles separated by `|||`. The webhook splits and sends them sequentially with an 800ms natural typing pause.
    - **Anti-Repetition & Memory**: Checks known database fields before asking questions. If bedrooms or location are already known, skips directly to missing fields.
    - **Structured JSON Extraction**: Forces Gemini to output JSON containing:
      - `text`: Response message string.
      - `replyType`: `"text" | "buttons" | "list"`.
      - `extractedData`: Object containing `name`, `budget`, `bedrooms`, `projectName`, `location`, `intent`, `propertyType`.
      - `handover`: Boolean flag triggering human agent notification when consultation completes.

### 8.2 `src/services/botService.js` (Decision Tree Bot)

- **Purpose**: Rule-based fallback system executing state-machine navigation across `BotFlow` and `BotNode` models when AI is disabled or fails.
- **Key Functions**:
  - `handleBotConversation(message, messageBody, recipientId, credentials)`: Transitions customer state (`awaiting_name` $\to$ `awaiting_email` $\to$ `END`).
  - `fillTemplate(text, enquiry)`: Replaces tokens like `{{name}}`, `{{projectName}}` in flow messages.

### 8.3 `src/controllers/botController.js` (DataBot - Internal CRM Intelligence)

- **Purpose**: Natural-language query assistant for internal staff on the frontend dashboard.
- **Function**:
  - `parseQueryAndRespond(req, res)`:
    - Analyzes natural queries (e.g., _"What is our response rate in the last 7 days?"_, _"Which list got the most leads?"_).
    - Runs MongoDB aggregations on `Campaign`, `Contact`, `Analytics`, and `Enquiry` to return instant summary answers.

---

## 9. Controllers & API Endpoint Reference

### 9.1 `campaignController.js`

- `getCampaigns`: Fetches campaigns with access control and pagination.
- `getRecipientCount`: Calculates anticipated target audience count based on contact lists, exclusion lists, and status filters.
- `createCampaign`: Validates template variables, header media, target filters, and schedules or saves drafts.
- `executeCampaign`: Triggers immediate background dispatch.
- `pauseCampaignHandler` / `resumeCampaignHandler`: In-flight campaign pause/resume.
- `deleteCampaign`: Deletes campaign and associated analytics.

### 9.2 `contactController.js`

- `createContactList`: Creates named contact segment with `createdBy` tracking.
- `getAllContactLists`: Lists segments filtered by user permissions.
- `bulkAddContacts`: Parses CSV/Excel inputs, upserts phone numbers, and initializes default stats.
- `getContactsInList`: Paginated search and filtering for contacts in a list.
- `getContactStats`: Aggregates active contacts, opt-outs, and engagement breakdowns.
- `migrateContactStats`: Batch script that backfills historical stats and calculates initial engagement scores for legacy contacts.
- `getListStatusCounts`: Returns distribution counts for `Engaged`, `Unresponsive`, `New`, and `Dead` contacts in a list.

### 9.3 `replyController.js`

- `getConversations`: Returns paginated chat conversations grouped by phone number with unread badges, latest message preview, and search.
- `getMessagesByNumber`: Retrieves bidirectional message history between a business number and a customer.
- `markAsRead`: Marks incoming messages as read and informs Meta via read receipts.
- `sendReply`: Sends outbound text message from the live chat console.
- `sendMediaReply`: Uploads staff media attachments and delivers them to the customer.
- `sendReaction`: Adds emoji reactions to messages.
- `toggleSubscription`: Manually unsubscribes or re-subscribes a contact, restoring their previous list segment.

### 9.4 `templateController.js`

- `getTemplates`: Concurrently queries Meta Graph API for approved message templates and calls Meta template analytics to merge sent/read metrics.
- `createTemplate`: Submits newly authored WhatsApp templates with headers, body variables, and buttons to Meta for approval.
- `editTemplate`: Updates existing templates and invalidates local template cache.

### 9.5 `wabaController.js`

- `getAllWabaAccounts`: Returns connected WhatsApp Business Accounts and phone numbers with encrypted access tokens sanitized.
- `addWabaAccount`: Registers a new WABA with encrypted token storage.
- `connectWabaAccount`: One-click setup that fetches all active phone numbers from Meta and auto-subscribes the app to Meta webhooks.
- `updatePhoneNumber`: Configures phone-level toggles: `isAiEnabled`, `isFollowUpEnabled`, `isReviewEnabled`.

### 9.6 `enquiryController.js`

- `getEnquiries`: CRM lead table with multi-factor search (phone, name, project), status filters, date range filters, and pagination.
- `updateEnquiryStatus`: Updates lead pipeline status (`pending`, `contacted`, `closed`, `handover`).
- `exportEnquiries`: Generates CSV export of leads using `json2csv`.

### 9.7 `analyticsController.js`

- `getStats`: High-level dashboard counters (total sent, delivered, read, delivery rate, read rate).
- `getCampaignAnalytics`: Detailed performance breakdown per campaign.
- `getCampaignAnalyticsDetails`: Paginated list of message-level delivery statuses and failure reasons.
- `exportCampaignAnalytics`: Exports campaign delivery reports to CSV.

### 9.8 `userController.js` & `authController.js` & `twoFactorController.js`

- `login`: Validates credentials, checks 2FA requirements, and issues signed JWTs.
- `setupTwoFactorAuth`: Generates TOTP secrets and QR codes using `speakeasy` and `qrcode`.
- `verifyTwoFactorAuth`: Verifies 6-digit TOTP codes for two-factor authentication.
- `getUsers`, `createUser`, `updateUser`: Team management and WABA/Contact List assignment for RBAC.

---

## 10. Mongoose Data Models & Database Schemas

| Model                    | Collection                | Primary Responsibility                                                                                                                                                                                                                 |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `User`                   | `users`                   | Staff credentials, bcrypt password hash, roles (`admin`, `manager`, `viewer`), assigned WABAs and contact lists, 2FA secret.                                                                                                           |
| `WabaAccount`            | `wabaaccounts`            | Meta WhatsApp Business Account ID, account name, AES-encrypted permanent access token, master spreadsheet ID.                                                                                                                          |
| `PhoneNumber`            | `phonenumbers`            | Meta Phone Number ID, display name, WABA reference, feature flags (`isAiEnabled`, `isFollowUpEnabled`, `isReviewEnabled`).                                                                                                             |
| `ContactList`            | `contactlists`            | Segmentation groups for contacts, creator ownership (`createdBy`).                                                                                                                                                                     |
| `Contact`                | `contacts`                | Phone number, BSUID, name, variables map (`var1`, `var2`), subscription status, unsubscribe reason/date, stats counters (`sent`, `read`, `replied`), engagement score, and computed status (`New`, `Engaged`, `Unresponsive`, `Dead`). |
| `Campaign`               | `campaigns`               | Campaign name, template details, media header ID/URL, body variables, status (`draft`, `scheduled`, `sending`, `sent`, `paused`, `failed`), batch settings (`batchSize`, `batchDelay`, `messageDelay`), exclusion list.                |
| `Analytics`              | `analytics`               | Message-level audit log keyed by `wamid`. Tracks status (`sent`, `delivered`, `read`, `failed`, `skipped`) and Meta error codes/reasons.                                                                                               |
| `Reply`                  | `replies`                 | Two-way chat messages. Stores direction (`incoming` / `outgoing`), sender/recipient IDs, text body, media URLs, interactive buttons/lists, read status, and timestamps.                                                                |
| `Enquiry`                | `enquiries`               | Real estate leads captured from website, campaigns, or AI chats. Stores customer preferences (budget, bedrooms, project, location), handover status, review ratings, and follow-up flags.                                              |
| `PropertyInquirySession` | `propertyinquirysessions` | 24-hour state machine tracking 2-step website link inquiries.                                                                                                                                                                          |
| `Property`               | `properties`              | Real estate listings database (name, developer, location, price, bedrooms, tags, brochure URLs) used by AI for customer recommendations.                                                                                               |
| `Log`                    | `logs`                    | Audit trail recording campaign executions, user management actions, and system scheduler events.                                                                                                                                       |

---

_Created as the Developer Architecture Reference for the WhatsApp Business API Platform._
