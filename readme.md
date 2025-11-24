# WhatsApp Campaign Manager - Backend

This is the Node.js, Express, and MongoDB backend for the WhatsApp Campaign Manager application. It handles all business logic, API endpoints, database interactions, and communication with the WhatsApp Business API.

---

## Features

- **Campaign Management**: Create, read, and send marketing campaigns.
- **Recipient Management**: Bulk import recipients from a CSV file.
- **Real-time Replies**: Receive incoming user replies via a secure webhook.
- **User Authentication**: Secure user registration and login using JWT (JSON Web Tokens).
- **WhatsApp API Integration**: A dedicated service for sending messages via the Meta Cloud API.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) account
- [Postman](https://www.postman.com/) (for testing)
- WhatsApp Business API credentials from the [Meta for Developers](https://developers.facebook.com/) dashboard.

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repository-url>
    cd whatsapp-campaign-manager/backend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Create a `.env` file:**
    Create a `.env` file in the `backend` root folder and add the required environment variables (see below).

4.  **Run the server:**
    ```bash
    npm start
    ```
    The server will start on `http://localhost:5001`.
