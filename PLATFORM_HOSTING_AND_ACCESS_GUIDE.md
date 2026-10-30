# Platform Hosting, Account Setup & Rehosting Guide

**Project**: WhatsApp Business API Marketing, Automation & CRM Platform  
**Target Architecture**: Vercel (Frontend) + Render (Backend) + MongoDB Atlas (Database) + Cloudinary (CDN) + Meta WhatsApp Cloud API  
**Purpose**: Complete, step-by-step technical guide for configuring accounts and deploying this platform in a new environment from scratch without dependencies on previous domains, credentials, or URLs.

---

## 1. Hosting Architecture Overview

The system is designed across modern cloud platforms to separate client interfaces, server logic, data storage, and external communications:

```
                              ┌───────────────────────────────────────────────┐
                              │            Meta Developer Portal              │
                              │           (WhatsApp Graph API v20.0)          │
                              └───────────────────────┬───────────────────────┘
                                                      │
                       Inbound Webhooks (HTTPS POST)  │  Outbound Messages & Templates
                     https://<YOUR_BACKEND_URL>/api/webhook (System User Access Token)
                                                      ▼
 ┌───────────────────────────┐             ┌─────────────────────────────────────┐
 │    Customer on WhatsApp   │◄───────────►│            Render Backend           │
 │ (Text, Voice, Image, Doc) │             │       (Node.js Express + Sockets)   │
 └───────────────────────────┘             └──────┬───────────────────────┬──────┘
                                                  │                       │
                         Socket.IO (WebSockets)   │                       │ Mongoose Connection
                       (newMessage, statusUpdate) │                       │ (ReplicaSet / SSL)
                                                  ▼                       ▼
                                       ┌────────────────────┐   ┌─────────────────┐
                                       │    Vercel Client   │   │  MongoDB Atlas  │
                                       │ (React 18 + SPA)   │   │   (ReplicaSet)  │
                                       └────────────────────┘   └─────────────────┘
                                                  │
                                                  ▼
                                       ┌────────────────────┐
                                       │   Cloudinary CDN   │
                                       │ (Media Attachments)│
                                       └────────────────────┘
```

| Component | Platform | Primary Function |
|---|---|---|
| **Frontend UI** | [Vercel](https://vercel.com) | Serves the compiled React 18 Single-Page Application (CRA). Handles campaign creation, live chat, CRM lead lists, template management, and visual bot flows. |
| **Backend API & WebSockets** | [Render](https://render.com) | Runs the Node.js Express server, bi-directional Socket.IO engine, automated schedulers, and incoming Meta webhook ingestion. |
| **Database** | [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) | Cloud NoSQL database storing users, contacts, contact lists, campaigns, message analytics, chat history, and CRM enquiries. |
| **Media CDN** | [Cloudinary](https://cloudinary.com) | Media asset storage for WhatsApp campaign headers (images, documents, videos) and live chat attachments. |
| **WhatsApp Engine** | [Meta for Developers](https://developers.facebook.com) | Meta WhatsApp Cloud API infrastructure providing business phone number connectivity, template approvals, and webhook dispatches. |
| **2FA & Alert SMTP** | Standard SMTP (e.g., Gmail) | Email delivery service for Two-Factor Authentication (2FA) login verification codes. |

---

## 2. Required Accounts & Access Portals

To deploy this platform in a new environment, create accounts on the following portals:

1. **Vercel** (`https://vercel.com`): For deploying the React frontend repository.
2. **Render** (`https://render.com`): For deploying the Node.js backend Web Service.
3. **MongoDB Atlas** (`https://cloud.mongodb.com`): For hosting the managed database cluster.
4. **Cloudinary** (`https://cloudinary.com`): For media hosting API keys.
5. **Meta for Developers** (`https://developers.facebook.com`): For creating and managing the WhatsApp Cloud API application.
6. **Meta Business Manager** (`https://business.facebook.com`): For generating permanent system user tokens and managing business verification.
7. **SMTP Mail Provider**: Any standard SMTP account for delivering 2FA authentication emails.

---

## 3. Environment Variables Reference & Configuration

All secrets and endpoints are managed strictly through environment variables.

### 3.1 Backend Environment Variables (Render)

Configure these in the **Environment** settings of your backend service on Render:

| Variable Name | Required | Format / Placeholder | Description |
|---|---|---|---|
| `PORT` | **Yes** | `10000` | Port for the HTTP and Socket.IO server. Render automatically routes external traffic to `10000`. |
| `MONGO_URI` | **Yes** | `mongodb+srv://<USER>:<PASSWORD>@<CLUSTER>.mongodb.net/<DB_NAME>?retryWrites=true&w=majority` | Connection string obtained from MongoDB Atlas. |
| `ENCRYPTION_KEY` | **Yes** | `<32_CHARACTER_RANDOM_SECRET_KEY>` | Exactly 32 characters long. Used by AES-256-CBC to encrypt access tokens stored in the database. |
| `JWT_SECRET` | **Yes** | `<RANDOM_ALPHANUMERIC_STRING>` | Secret key used to sign and verify JSON Web Tokens for user authentication. |
| `JWT_EXPIRE` | **Yes** | `30d` | Token expiration period (e.g., `30d`, `7d`). |
| `WHATSAPP_ACCESS_TOKEN` | **Yes** | `EAA...` (Long string) | Permanent Meta System User Token with WhatsApp messaging permissions. |
| `WHATSAPP_PHONE_NUMBER_ID`| **Yes** | `<YOUR_META_PHONE_NUMBER_ID>` | Numerical ID of your registered WhatsApp Business phone number. |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | **Yes** | `<YOUR_META_WABA_ID>` | Numerical ID of your WhatsApp Business Account (WABA). |
| `WHATSAPP_VERIFY_TOKEN` | **Yes** | `<CUSTOM_SECRET_STRING>` | Any custom string you define (e.g. `my_secure_webhook_token_123`) to verify webhooks with Meta. |
| `FACEBOOK_APP_ID` | **Yes** | `<YOUR_FACEBOOK_APP_ID>` | Meta App ID from the App Settings page in Meta Developer Portal. |
| `FACEBOOK_APP_SECRET` | **Yes** | `<YOUR_FACEBOOK_APP_SECRET>` | Meta App Secret from the App Settings page in Meta Developer Portal. |
| `FACEBOOK_API_VERSION` | No | `v20.0` | Meta Graph API version. |
| `CLOUDINARY_CLOUD_NAME` | **Yes** | `<YOUR_CLOUDINARY_CLOUD_NAME>` | Cloud Name from your Cloudinary console. |
| `CLOUDINARY_API_KEY` | **Yes** | `<YOUR_CLOUDINARY_API_KEY>` | API Key from your Cloudinary console. |
| `CLOUDINARY_API_SECRET` | **Yes** | `<YOUR_CLOUDINARY_API_SECRET>` | API Secret from your Cloudinary console. |
| `SMTP_HOST` | No | `smtp.gmail.com` | SMTP host for 2FA emails. |
| `SMTP_PORT` | No | `587` | SMTP port (587 for TLS). |
| `SMTP_USER` | No | `<YOUR_EMAIL_ADDRESS>` | SMTP username or email. |
| `SMTP_PASS` | No | `<YOUR_EMAIL_APP_PASSWORD>` | SMTP password or 16-character App Password. |
| `FROM_EMAIL` | No | `<YOUR_EMAIL_ADDRESS>` | Sender email address for 2FA messages. |
| `FROM_NAME` | No | `WhatsApp CRM` | Sender display name. |

---

### 3.2 Frontend Environment Variables (Vercel)

Configure this in the **Environment Variables** settings of your project on Vercel:

| Variable Name | Required | Format / Placeholder | Description |
|---|---|---|---|
| `REACT_APP_API_URL` | **Yes** | `https://<YOUR_RENDER_BACKEND_URL>` | Full HTTPS URL pointing to the deployed Render backend (no trailing slash). |

---

## 4. Step-by-Step Rehosting Guide (Deploying to a New Place)

Follow these steps sequentially to set up the system completely from scratch.

---

### Step 1: Set Up MongoDB Atlas (Database)

1. Log in to [MongoDB Atlas](https://cloud.mongodb.com).
2. Create a new cluster in the geographic region closest to your target users.
3. **Create Database User**:
   - Go to **Security $\to$ Database Access $\to$ Add New Database User**.
   - Authentication Method: **Password**.
   - Assign user role: **Read and write to any database** (`readWriteAnyDatabase`).
4. **Configure IP Access List**:
   - Go to **Security $\to$ Network Access $\to$ Add IP Address**.
   - Add `0.0.0.0/0` (Allow access from anywhere).
   - *Rationale*: Render uses dynamic outbound IP addresses; allowing `0.0.0.0/0` ensures the backend can always connect securely via SSL/TLS.
5. **Get Connection String**:
   - Click **Database $\to$ Connect $\to$ Drivers (Node.js)**.
   - Copy the SRV connection URI:
     ```
     mongodb+srv://<USER>:<PASSWORD>@<CLUSTER>.mongodb.net/<DB_NAME>?retryWrites=true&w=majority
     ```
   - Store this for your `MONGO_URI` variable.

---

### Step 2: Set Up Cloudinary (Media Storage)

1. Log in to [Cloudinary](https://cloudinary.com).
2. From the main console dashboard, copy the **Product Environment Credentials**:
   - **Cloud Name** $\to$ `CLOUDINARY_CLOUD_NAME`
   - **API Key** $\to$ `CLOUDINARY_API_KEY`
   - **API Secret** $\to$ `CLOUDINARY_API_SECRET`

---

### Step 3: Set Up Meta WhatsApp Cloud API

1. **Create App in Meta Developer Portal**:
   - Go to [Meta for Developers](https://developers.facebook.com).
   - Click **Create App** $\to$ Select Type: **Business**.
   - Under Add Products, add **WhatsApp**.
2. **Collect IDs**:
   - In the left sidebar, navigate to **WhatsApp $\to$ API Setup**:
     - Copy **Phone Number ID** $\to$ `WHATSAPP_PHONE_NUMBER_ID`
     - Copy **WhatsApp Business Account ID** $\to$ `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - In the left sidebar, navigate to **App Settings $\to$ Basic**:
     - Copy **App ID** $\to$ `FACEBOOK_APP_ID`
     - Copy **App Secret** $\to$ `FACEBOOK_APP_SECRET`
3. **Generate Permanent System User Token**:
   - Do not use the temporary 24-hour token from the API Setup tab.
   - Open [Meta Business Manager](https://business.facebook.com/settings).
   - Go to **Users $\to$ System Users $\to$ Add**.
   - Create a System User with **Admin** access.
   - Click **Add Assets** and grant Full Control over your Meta App and your WhatsApp Account.
   - Click **Generate New Token**:
     - Select your App.
     - Token Expiration: **Never**.
     - Permissions to check:
       - `whatsapp_business_messaging`
       - `whatsapp_business_management`
     - Generate and copy this token $\to$ `WHATSAPP_ACCESS_TOKEN`.
4. **Choose Webhook Verify Token**:
   - Create any random string (e.g. `verify_token_abcdef123`) $\to$ `WHATSAPP_VERIFY_TOKEN`.

---

### Step 4: Deploy the Backend on Render

1. Log in to [Render](https://render.com).
2. Click **New + $\to$ Web Service**.
3. Connect your Git repository.
4. **Set Service Parameters**:
   - **Name**: Choose your backend name (e.g., `whatsapp-crm-backend`).
   - **Region**: Choose region closest to your MongoDB Atlas cluster.
   - **Branch**: `main` (or your deployment branch).
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node src/server.js`
5. **Add Environment Variables**:
   - Under the **Environment** tab, add all keys listed in Section 3.1.
6. **Trigger Deployment**:
   - Click **Create Web Service**.
   - When the build finishes, verify the logs display:
     ```
     Connected to MongoDB Atlas successfully!
     🚀 Server is running on http://localhost:10000
     ```
   - Copy your public service URL:  
     `https://<YOUR_RENDER_APP_NAME>.onrender.com`

---

### Step 5: Configure Meta Webhook URL

1. Go back to [Meta for Developers](https://developers.facebook.com) $\to$ Your App.
2. Navigate to **WhatsApp $\to$ Configuration $\to$ Webhook $\to$ Edit**:
   - **Callback URL**: `https://<YOUR_RENDER_APP_NAME>.onrender.com/api/webhook`
   - **Verify Token**: Enter the exact string set in `WHATSAPP_VERIFY_TOKEN`.
   - Click **Verify and Save**.
3. Under **Webhook fields**, click **Manage**:
   - Click **Subscribe** on the **`messages`** row.

---

### Step 6: Deploy the Frontend on Vercel

1. Log in to [Vercel](https://vercel.com).
2. Click **Add New... $\to$ Project** and select your Git repository.
3. **Configure Project Settings**:
   - **Framework Preset**: `Create React App`
   - **Root Directory**: Click *Edit* and select **`frontend`**.
   - **Build Command**: `npm run build`
   - **Output Directory**: `build`
4. **Set Environment Variable**:
   - Key: `REACT_APP_API_URL`
   - Value: `https://<YOUR_RENDER_APP_NAME>.onrender.com` (no trailing slash).
5. **Verify Single-Page Application Rewrites**:
   - Confirm [`frontend/vercel.json`](file:///c:/Users/TCA/Desktop/HANDOVER%20SIRAJ/Whatsapp-api/frontend/vercel.json) exists with:
     ```json
     {
       "rewrites": [
         {
           "source": "/(.*)",
           "destination": "/index.html"
         }
       ]
     }
     ```
   - This prevents 404 errors when refreshing direct routes like `/replies` or `/campaigns`.
6. Click **Deploy**. Vercel will build the frontend and provide your live application URL:  
   `https://<YOUR_VERCEL_APP_NAME>.vercel.app`

---

### Step 7: Configure CORS in Backend (if using custom domains)

In [`backend/src/server.js`](file:///c:/Users/TCA/Desktop/HANDOVER%20SIRAJ/Whatsapp-api/backend/src/server.js), the server allows:
- `http://localhost:3000`
- Any domain ending in `.vercel.app`
- Any domain ending in `.onrender.com`

If you attach a custom domain (e.g. `https://crm.yourcompany.com`), add it to the `allowedOrigins` array in `backend/src/server.js`:
```javascript
const allowedOrigins = [
  "http://localhost:3000",
  "https://crm.yourcompany.com", // <-- Add your custom frontend domain here
];
```

---

## 5. Verification & Smoke Test Checklist

Once both services are deployed, perform these checks:

1. **Backend Health Check**:
   - Open `https://<YOUR_RENDER_APP_NAME>.onrender.com/health` in your browser.
   - It should respond with: `{"status":"UP","timestamp":"..."}`.
2. **Initial Admin Creation**:
   - On a fresh database, register the first user or insert an administrator record into the `users` collection with `role: "admin"`.
3. **Frontend Login**:
   - Open `https://<YOUR_VERCEL_APP_NAME>.vercel.app`, log in, and verify the dashboard renders.
4. **Live Chat WebSocket Verification**:
   - Open browser developer tools Console (`F12`).
   - Look for the confirmation log: `📡 Connected to Socket.IO server!`.
5. **Inbound WhatsApp Message Test**:
   - Send a WhatsApp test message to your business phone number.
   - Verify the message arrives in the Render backend log and pops up in real-time on the `/replies` live chat interface.
6. **Campaign & Media Test**:
   - Create a test campaign with a template and header image.
   - Confirm Cloudinary stores the asset and the campaign dispatches successfully.

---

## 6. Maintenance & Operational Tips

- **Render Inactivity Keep-Alive**:
  - If using an inactive sleep timeout on Render, use a free uptime monitoring service (e.g. UptimeRobot or Cron-job.org) to ping `https://<YOUR_RENDER_APP_NAME>.onrender.com/health` every 10 minutes. This ensures incoming webhooks and WebSocket connections are never delayed.
- **Access Token Updates**:
  - If your Meta access token is ever rotated, update the `WHATSAPP_ACCESS_TOKEN` environment variable on Render, and update any saved accounts on the frontend **Integrations** page.
- **Database Backup**:
  - Export regular database snapshots using `mongodump`:
    ```bash
    mongodump --uri="<YOUR_MONGO_URI>" --out="./backup_$(date +%Y%m%d)"
    ```
