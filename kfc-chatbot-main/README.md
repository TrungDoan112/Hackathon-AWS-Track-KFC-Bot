# KFC Vietnam Conversational Ordering — Local Demo

MVP này chạy hoàn toàn trên local: Express nhận tin nhắn, OpenAI Agents SDK quyết định gọi tool, tool cập nhật SQLite, và dashboard nhân viên tự làm mới mỗi giây.

## Chạy nhanh

Yêu cầu: Node.js 24 trở lên và file `.env` có `OPENAI_API_KEY`.

```bash
npm install
npm start
```

- Dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard) (hỗ trợ toggle VI/EN)
- Health check: [http://localhost:3000/health](http://localhost:3000/health)
- Chat SSE: `POST http://localhost:3000/api/chat`
- Zalo webhook: `POST http://localhost:3000/api/zalo/webhook`
- Trạng thái Zalo: `GET http://localhost:3000/api/zalo/status`
- Alias tương thích: `POST http://localhost:3000/chat`
- Postman collection: `postman/KFC Local Demo.postman_collection.json`

Database và menu được khởi tạo tự động khi server start. Có thể chạy riêng:

```bash
npm run db:setup
npm test
npm run reset:demo
```

## Gọi bằng Postman

Chọn `POST`, body kiểu JSON, và thêm header `Accept: text/event-stream`:

```json
{
  "sessionId": "happy-demo",
  "userId": "customer-001",
  "message": "Hello, cho mình xem menu gà rán hôm nay."
}
```

Response là Server-Sent Events (SSE), gồm các event chính:

- `assistant.delta`: từng phần câu trả lời, tạo cảm giác stream như ChatGPT.
- `tool.started` / `tool.completed`: agent bắt đầu và hoàn tất tool.
- `state.updated`: SQLite vừa thay đổi; dashboard sẽ thấy ở lần poll kế tiếp.
- `assistant.completed`: câu trả lời đầy đủ.
- `done`: turn hoàn tất.
- `error`: lỗi sau khi stream đã bắt đầu.

Nếu Postman gom output thành một cục, kiểm tra stream thật bằng:

```bash
curl.exe -N -X POST http://localhost:3000/api/chat ^
  -H "Content-Type: application/json" ^
  -H "Accept: text/event-stream" ^
  -d "{\"sessionId\":\"happy-demo\",\"userId\":\"customer-001\",\"message\":\"Cho mình xem menu gà rán hôm nay\"}"
```

## Ba luồng demo

Mỗi luồng dùng một `sessionId`; dashboard giữ cả ba và cho phép chuyển phiên.

### 1. Happy Path

Gửi lần lượt với `sessionId: happy-demo`:

1. `Hello, cho mình xem menu gà rán hôm nay.`
2. `Lấy mình 1 combo Gà Rán Vui Vẻ, giao đến 123 Nguyễn Văn Linh.`

Kỳ vọng: agent map tên đời thường vào `Combo Nhóm 2 Vui Vẻ`, tính 159.000đ, tạo đúng một đơn và dashboard chuyển sang `Đã tạo đơn`.

### 2. Messy Order

Gửi với `sessionId: messy-demo`:

`Cho anh 2 miếng gà cay... à khoan, đổi thành 1 cay 1 không cay đi. Thêm 1 khoai tây chiên size L, nhớ bỏ ít đá trong ly pepsi nha.`

Kỳ vọng cuối cùng: một gà cay, một gà không cay, khoai L và Pepsi tiêu chuẩn có ghi chú `Ít đá`. Tổng trước voucher là 117.000đ. Vì chưa có địa chỉ và chưa yêu cầu chốt rõ ràng, agent chỉ cập nhật giỏ rồi hỏi thêm.

### 3. Loyalty & Voucher

Gửi lần lượt với `sessionId: integration-demo`:

1. `Thêm 1 Combo Nhóm 2 Vui Vẻ vào giỏ, mình chưa chốt đơn.`
2. `Kiểm tra điểm thành viên số 0901234567 giúp mình. Đơn này xài mã KFC50K được không?`

Kỳ vọng: 150 điểm, mã hợp lệ, giảm đúng 50.000đ. Tổng giỏ từ 159.000đ còn 109.000đ.

## Kiến trúc và các layer

```text
Postman ──────────────── POST /api/chat (SSE)
Zalo ────────────────── POST /api/zalo/webhook
        ▼
src/routes              HTTP validation + SSE framing
        ▼
src/application         quản lý một turn, memory và khóa theo session
        ▼
src/agent               prompt + 6 tool OpenAI Agents SDK
        ▼
src/infrastructure      nghiệp vụ xác định + SQLite + menu importer
        │
        ├── data/kfc-demo.sqlite
        └── GET /api/dashboard/snapshot
                         ▼
                   public/ dashboard
```

Các tool hiện có:

1. `search_menu`
2. `get_cart`
3. `update_cart`
4. `check_loyalty`
5. `apply_voucher`
6. `create_order`

Mọi giá tiền, discount và total đều do backend tính. LLM không được phép truyền hoặc tự quyết định số tiền. `create_order` có unique constraint theo giỏ nên gọi lại không sinh đơn trùng.

## Dataset local

`kfc_menu.json` hiện là snapshot nguồn với 94 món, được import vào bảng `products` khi khởi động. Không cần crawl thêm cho hackathon vì:

- dữ liệu đủ cho ba kịch bản;
- demo không phụ thuộc internet ngoài OpenAI API;
- dễ tái lập và không bị website KFC thay đổi ngay trước lúc trình bày.

Importer tự chuẩn hóa dấu tiếng Việt và bổ sung alias cho `Combo Gà Rán Vui Vẻ`, gà cay/không cay, khoai size L và Pepsi. Dataset không có SKU riêng cho gà cay/không cay, nên hai lựa chọn được lưu thành hai `variant` của cùng sản phẩm thật.

Khi muốn cập nhật snapshot sau hackathon, thay `kfc_menu.json` bằng file cùng schema rồi restart; hash file thay đổi sẽ kích hoạt upsert lại menu.

## API bổ sung

- `GET /api/dashboard/snapshot?sessionId=happy-demo`: snapshot dashboard.
- `GET /api/zalo/status`: kiểm tra adapter Zalo đã có token/secret hay chưa, không lộ giá trị bí mật.
- `POST /api/zalo/webhook`: nhận webhook Zalo, xác thực `X-Bot-Api-Secret-Token`, trả `200` ngay rồi xử lý agent theo hàng đợi của từng cuộc chat.
- `POST /api/demo/reset` với `{ "sessionId": "happy-demo" }`: reset một phiên.
- `POST /api/demo/reset` với `{}`: reset toàn bộ dữ liệu demo, vẫn giữ menu/loyalty/voucher.

### Handoff (nhân viên tiếp quản)

Ba endpoint **không yêu cầu xác thực** cho phép dashboard nhân viên tiếp quản cuộc chat:

- `POST /api/sessions/:id/take-over`: đặt phiên sang chế độ `human`. Bot tạm dừng trả lời.
- `POST /api/sessions/:id/hand-back`: đặt phiên về chế độ `bot`.
- `POST /api/sessions/:id/human-message`: gửi tin nhắn từ nhân viên đến khách (qua Zalo nếu có `zalo_chat_id`). Yêu cầu phiên ở chế độ `human` và có `zalo_chat_id` trên hồ sơ.

Phiên (`sessions`) có hai cột mới để hỗ trợ:
- `control_mode`: `'bot'` (mặc định) hoặc `'human'`.
- `zalo_chat_id`: địa chỉ cuộc chat Zalo nếu tin nhắn đến từ Zalo.

Bảng `messages` hỗ trợ role `'human_agent'` để lưu tin nhắn nhân viên.

## Kết nối Zalo Bot

Thêm ba biến sau vào `.env` (không commit token/secret):

```dotenv
ZALO_BOT_TOKEN=...
ZALO_WEBHOOK_SECRET=chuoi-bi-mat-tu-8-den-256-ky-tu
PUBLIC_BASE_URL=https://ten-mien-https-cong-khai.example
```

Khi chạy local, tạo URL HTTPS bằng tunnel như `ngrok http 3000`, đặt URL đó vào `PUBLIC_BASE_URL`, khởi động server rồi đăng ký webhook:

```bash
npm run zalo:webhook:set
npm run zalo:webhook:info
npm run zalo:bot:info
```

Có thể truyền URL trực tiếp mà không sửa `.env`:

```bash
npm run zalo:webhook:set -- https://your-public-url.example
```

Luồng xử lý:

1. Zalo gửi `message.text.received` và secret header.
2. Server xác thực secret, ghi `message_id` vào SQLite để chống xử lý trùng và trả HTTP `200` ngay.
3. Tin nhắn cùng một cuộc chat được xử lý tuần tự qua cùng `ChatService`/agent/tool.
4. Bot bật trạng thái `typing`, gửi câu trả lời cuối qua `sendMessage`; dashboard thấy ngay mọi thay đổi đã ghi vào SQLite.

Zalo giới hạn tin văn bản 2.000 ký tự; adapter tự chia câu trả lời dài thành nhiều tin. Các event ảnh, sticker, voice và unsupported hiện được xác nhận nhưng bỏ qua an toàn.

Adapter hiện là bản local/single-process: hàng đợi tuần tự nằm trong RAM. Khi deploy nhiều instance trên AWS, thay hàng đợi này bằng SQS FIFO với `MessageGroupId=sessionId` (hoặc cơ chế khóa phân tán) để giữ thứ tự và phục hồi job sau restart.

## Dashboard

Dashboard nhân viên (`/dashboard`) cung cấp:

- **Live-chat handoff**: nút tiếp quản để nhân viên chuyển sang chế độ trả lời trực tiếp, gửi tin nhắn đến khách hàng qua Zalo, và trả lại quyền cho bot. Mỗi tin nhắn từ nhân viên được lưu với role `human_agent`.
- **Ngôn ngữ giao diện**: toggle VI/EN tại giao diện. Chỉ ảnh hưởng dashboard; tin nhắn bot và Zalo vẫn tiếng Việt. Lựa chọn được lưu vào localStorage.

## Phạm vi MVP

Không có payment, vector database hay triển khai AWS. API chat và dashboard vẫn là bản local demo; Zalo adapter dùng shared-secret webhook và chưa thay thế lớp authentication/authorization production. Dashboard hỗ trợ human handoff (tiếp quản) qua ba endpoint không xác thực (chấp nhận rủi ro vì đây là demo local).
