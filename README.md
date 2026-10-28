# Agentic AI Conversational Ordering — Local Demo

This MVP runs entirely locally. Express receives messages, the OpenAI Agents SDK decides which tools to call, the tools update SQLite, and the staff dashboard refreshes automatically every second.

> **Scope note:** This is an independent proof of concept for an F&B ordering use case. It is a local demo, not an official KFC Vietnam deployment, and it is not connected to KFC's live production systems.

## Quick start

**Requirements:** Node.js 24 or later, and an `.env` file containing `OPENAI_API_KEY`.

```bash
npm install
npm start
```

Once the server is running, use these endpoints:

- Staff dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- Health check: [http://localhost:3000/health](http://localhost:3000/health)
- Chat endpoint (SSE): `POST http://localhost:3000/api/chat`
- Zalo webhook: `POST http://localhost:3000/api/zalo/webhook`
- Zalo integration status: `GET http://localhost:3000/api/zalo/status`
- Backward-compatible chat alias: `POST http://localhost:3000/chat`
- Postman collection: `postman/KFC Local Demo.postman_collection.json`

The database and menu are initialized automatically when the server starts. You can also run these commands separately:

```bash
npm run db:setup
npm test
npm run reset:demo
```

## Send a request with Postman

Use the `POST` method, select a JSON request body, and add the header `Accept: text/event-stream`:

```json
{
  "sessionId": "happy-demo",
  "userId": "customer-001",
  "message": "Hello, cho mình xem menu gà rán hôm nay."
}
```

The response is streamed as Server-Sent Events (SSE). The main event types are:

- `assistant.delta`: a partial response, streamed to create a ChatGPT-like experience.
- `tool.started` / `tool.completed`: a tool call has started or completed.
- `state.updated`: SQLite has changed; the dashboard reflects the update on its next poll.
- `assistant.completed`: the complete assistant response.
- `done`: the turn has finished.
- `error`: an error occurred after streaming began.

If Postman displays the output as one block instead of a stream, use `curl` to inspect the live stream:

```bash
curl.exe -N -X POST http://localhost:3000/api/chat ^
  -H "Content-Type: application/json" ^
  -H "Accept: text/event-stream" ^
  -d "{\"sessionId\":\"happy-demo\",\"userId\":\"customer-001\",\"message\":\"Cho mình xem menu gà rán hôm nay\"}"
```

## Three demo scenarios

Each scenario uses its own `sessionId`. The dashboard keeps all three sessions available and lets you switch between them.

### 1. Happy path

Send these messages in order using `sessionId: happy-demo`:

1. `Hello, cho mình xem menu gà rán hôm nay.`
2. `Lấy mình 1 combo Gà Rán Vui Vẻ, giao đến 123 Nguyễn Văn Linh.`

**Expected result:** The agent maps the customer's casual wording to `Combo Nhóm 2 Vui Vẻ`, calculates a total of **VND 159,000**, creates exactly one order, and updates the dashboard status to `Order Created` (`Đã tạo đơn`).

### 2. Messy order

Send this message using `sessionId: messy-demo`:

`Cho anh 2 miếng gà cay... à khoan, đổi thành 1 cay 1 không cay đi. Thêm 1 khoai tây chiên size L, nhớ bỏ ít đá trong ly pepsi nha.`

**Expected result:** The final cart contains one spicy chicken piece, one non-spicy chicken piece, a large fries, and a regular Pepsi with the note `Ít đá` (less ice). The subtotal before applying a voucher is **VND 117,000**. Because the customer has not provided a delivery address or clearly confirmed the order, the agent updates the cart and asks for more information instead of placing the order.

### 3. Loyalty and voucher

Send these messages in order using `sessionId: integration-demo`:

1. `Thêm 1 Combo Nhóm 2 Vui Vẻ vào giỏ, mình chưa chốt đơn.`
2. `Kiểm tra điểm thành viên số 0901234567 giúp mình. Đơn này xài mã KFC50K được không?`

**Expected result:** The customer has **150 loyalty points**, the voucher is valid, and the order receives the correct **VND 50,000** discount. The cart total decreases from **VND 159,000** to **VND 109,000**.

## Architecture and layers

```text
Postman ──────────────── POST /api/chat (SSE)
Zalo ────────────────── POST /api/zalo/webhook
        ▼
src/routes              HTTP validation + SSE framing
        ▼
src/application         Turn lifecycle, memory, and per-session locking
        ▼
src/agent               Prompt + 6 OpenAI Agents SDK tools
        ▼
src/infrastructure      Deterministic business logic + SQLite + menu importer
        │
        ├── data/kfc-demo.sqlite
        └── GET /api/dashboard/snapshot
                         ▼
                   public/ dashboard
```

The six available tools are:

1. `search_menu`
2. `get_cart`
3. `update_cart`
4. `check_loyalty`
5. `apply_voucher`
6. `create_order`

The backend calculates all prices, discounts, and totals. The LLM cannot provide or independently determine monetary amounts. `create_order` has a unique constraint on the cart, so repeated calls do not create duplicate orders.

## Local menu dataset

`kfc_menu.json` is a snapshot containing **94 menu items**. It is imported into the `products` table when the application starts. The hackathon demo does not need to crawl the menu again because:

- the dataset covers all three demo scenarios;
- the demo does not depend on internet access apart from the OpenAI API;
- the data is reproducible and will not unexpectedly change if the KFC website is updated before a presentation.

The importer normalizes Vietnamese diacritics and adds aliases for `Combo Gà Rán Vui Vẻ`, spicy/non-spicy chicken, large fries, and Pepsi. The dataset does not contain separate SKUs for spicy and non-spicy chicken, so those choices are stored as two `variant` values for the same underlying product.

To update the snapshot after the hackathon, replace `kfc_menu.json` with a file that follows the same schema and restart the server. A changed file hash triggers a menu upsert.

## Additional API endpoints

- `GET /api/dashboard/snapshot?sessionId=happy-demo`: returns a dashboard snapshot.
- `GET /api/zalo/status`: checks whether the Zalo adapter has a token and secret configured, without exposing their values.
- `POST /api/zalo/webhook`: receives Zalo webhooks, validates `X-Bot-Api-Secret-Token`, immediately returns HTTP `200`, and then processes the agent task through the per-chat queue.
- `POST /api/demo/reset` with `{ "sessionId": "happy-demo" }`: resets one session.
- `POST /api/demo/reset` with `{}`: resets all demo data while preserving the menu, loyalty, and voucher data.

## Connect a Zalo Bot

Add the following three variables to `.env`. **Do not commit your bot token or webhook secret.**

```dotenv
ZALO_BOT_TOKEN=...
ZALO_WEBHOOK_SECRET=your-8-to-256-character-secret
PUBLIC_BASE_URL=https://your-public-https-domain.example
```

For local development, create a public HTTPS URL using a tunnel such as `ngrok http 3000`. Set that URL as `PUBLIC_BASE_URL`, start the server, and then register the webhook:

```bash
npm run zalo:webhook:set
npm run zalo:webhook:info
npm run zalo:bot:info
```

You can also pass the URL directly without editing `.env`:

```bash
npm run zalo:webhook:set -- https://your-public-url.example
```

### Webhook processing flow

1. Zalo sends the `message.text.received` event with a secret header.
2. The server validates the secret, records the `message_id` in SQLite to prevent duplicate processing, and immediately returns HTTP `200`.
3. Messages from the same chat are processed sequentially through the same `ChatService`, agent, and tools.
4. The bot sets its status to `typing`, sends the final answer through `sendMessage`, and the dashboard reflects any changes written to SQLite.

Zalo limits text messages to **2,000 characters**. The adapter automatically splits longer responses into multiple messages. Image, sticker, voice, and currently unsupported events are acknowledged but safely ignored.

The adapter is currently designed for a **local, single-process** environment: its sequential queue is stored in memory. For a multi-instance AWS deployment, replace this queue with SQS FIFO using `MessageGroupId=sessionId` (or use a distributed-locking mechanism) to preserve message order and recover jobs after a restart.

## MVP scope and limitations

- Payments are not implemented.
- Human handoff is not implemented.
- No vector database is used.
- The application has not been deployed to AWS; the chat API and dashboard are local demo components.
- The Zalo adapter uses a shared-secret webhook. It does not replace production-grade authentication and authorization for the other administrative APIs.
- Menu, voucher, loyalty, cart, and order-management behavior is based on local or simulated data, not live KFC production APIs.
