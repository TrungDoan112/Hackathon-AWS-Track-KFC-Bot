import { Agent, tool } from '@openai/agents';
import { z } from 'zod';

const cartOperationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_quantity'),
    productId: z.string().describe('ID món đã lấy từ search_menu'),
    quantity: z.number().int().min(0).max(100).describe('Số lượng cuối cùng khách muốn'),
    variant: z.string().optional().describe('Ví dụ: cay hoặc không cay'),
    note: z.string().optional().describe('Ghi chú riêng cho dòng món'),
  }),
  z.object({
    action: z.literal('add'),
    productId: z.string().describe('ID món đã lấy từ search_menu'),
    quantity: z.number().int().min(1).max(100).optional(),
    variant: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({
    action: z.literal('remove'),
    productId: z.string().describe('ID món cần xóa'),
    variant: z.string().optional().describe('Bỏ trống để xóa mọi biến thể của món'),
  }),
  z.object({
    action: z.literal('set_note'),
    productId: z.string().describe('ID món đã có trong giỏ'),
    variant: z.string().optional(),
    note: z.string().min(1).describe('Ghi chú thay thế hoàn toàn ghi chú cũ'),
  }),
]);

function safeError(error) {
  return {
    success: false,
    error: {
      code: error?.code || 'TOOL_ERROR',
      message: error?.message || 'Tool gặp lỗi không xác định.',
    },
  };
}

// Catches input-validation failures (e.g. quantity out of range) that the
// SDK rejects *before* our own execute()/instrument() ever runs — without
// this, the SDK's default error function returns a generic English string
// ("An error occurred while running the tool...") that the model then
// paraphrases into a confusing reply instead of a clear Vietnamese one.
function toolInputErrorFunction() {
  return JSON.stringify(safeError({
    code: 'INVALID_TOOL_INPUT',
    message: 'Giá trị gửi lên không hợp lệ, vui lòng thử lại với số lượng hoặc thông tin khác.',
  }));
}

function instrument({ name, label, mutates = false, store, sessionId, emit, execute }) {
  return async (input) => {
    emit('tool.started', { tool: name, label });
    try {
      const result = await execute(input);
      emit('tool.completed', { tool: name, label, result });
      if (mutates) {
        const snapshot = store.dashboardSnapshot(sessionId);
        emit('state.updated', {
          sessionId,
          version: snapshot.version,
          cartStatus: snapshot.cart?.status || null,
        });
      }
      return JSON.stringify(result);
    } catch (error) {
      const result = safeError(error);
      emit('tool.completed', { tool: name, label, result });
      return JSON.stringify(result);
    }
  };
}

export function createKfcAgent({ store, sessionId, userId, emit, model }) {
  const searchMenu = tool({
    name: 'search_menu',
    description: 'Tìm món KFC thật trong menu local theo tên, mô tả, loại món hoặc cách gọi đời thường.',
    errorFunction: toolInputErrorFunction,
    parameters: z.object({
      query: z.string().min(1).describe('Cụm từ tìm kiếm bằng tiếng Việt'),
      limit: z.number().int().min(1).max(10).optional(),
    }),
    execute: instrument({
      name: 'search_menu',
      label: 'Tìm món trong menu',
      store,
      sessionId,
      emit,
      execute: ({ query, limit }) => store.searchMenu(sessionId, query, limit || 6),
    }),
  });

  const getCart = tool({
    name: 'get_cart',
    description: 'Đọc trạng thái giỏ hàng hiện tại, bao gồm món, biến thể, ghi chú, địa chỉ và tổng tiền do backend tính.',
    errorFunction: toolInputErrorFunction,
    parameters: z.object({}),
    execute: instrument({
      name: 'get_cart',
      label: 'Đọc giỏ hàng',
      store,
      sessionId,
      emit,
      execute: () => store.getCart(sessionId),
    }),
  });

  const updateCart = tool({
    name: 'update_cart',
    description: [
      'Cập nhật giỏ hàng và/hoặc địa chỉ một cách xác định.',
      'Ưu tiên set_quantity để ghi số lượng cuối cùng thay vì cộng dồn.',
      'Có thể gửi nhiều operations trong một lần để xử lý câu đổi ý lộn xộn.',
    ].join(' '),
    errorFunction: toolInputErrorFunction,
    parameters: z.object({
      operations: z.array(cartOperationSchema).max(20).optional(),
      address: z.string().min(5).max(300).optional(),
    }),
    execute: instrument({
      name: 'update_cart',
      label: 'Cập nhật giỏ hàng',
      mutates: true,
      store,
      sessionId,
      emit,
      execute: ({ operations, address }) => store.updateCart(sessionId, {
        operations: operations || [],
        address,
      }),
    }),
  });

  const checkLoyalty = tool({
    name: 'check_loyalty',
    description: 'Tra cứu điểm thành viên giả lập theo số điện thoại trong database local.',
    errorFunction: toolInputErrorFunction,
    parameters: z.object({
      phone: z.string().min(9).describe('Số điện thoại khách cung cấp'),
    }),
    execute: instrument({
      name: 'check_loyalty',
      label: 'Kiểm tra điểm thành viên',
      mutates: true,
      store,
      sessionId,
      emit,
      execute: ({ phone }) => store.checkLoyalty(sessionId, phone),
    }),
  });

  const applyVoucher = tool({
    name: 'apply_voucher',
    description: [
      'Kiểm tra và áp dụng voucher vào giỏ hiện tại.',
      'Hỗ trợ KFC10, KFC20, KFC30, KFC40, KFC50, KFC60, KFC70, KFC80, KFC90 và KFC100',
      'tương ứng giảm từ 10% đến 100%. Backend tự tính điều kiện và số tiền giảm.',
    ].join(' '),
    errorFunction: toolInputErrorFunction,
    parameters: z.object({
      code: z.string().min(1).describe('Mã voucher, ví dụ KFC10, KFC50 hoặc KFC100'),
      phone: z.string().min(9).optional(),
    }),
    execute: instrument({
      name: 'apply_voucher',
      label: 'Áp dụng voucher',
      mutates: true,
      store,
      sessionId,
      emit,
      execute: ({ code, phone }) => store.applyVoucher(sessionId, code, phone),
    }),
  });

  const createOrder = tool({
    name: 'create_order',
    description: 'Chốt đơn từ giỏ hiện tại. Chỉ dùng khi khách đã thể hiện ý định đặt/chốt và giỏ có địa chỉ.',
    errorFunction: toolInputErrorFunction,
    parameters: z.object({
      phone: z.string().min(9).optional().describe('Số điện thoại nếu khách đã cung cấp'),
    }),
    execute: instrument({
      name: 'create_order',
      label: 'Tạo đơn hàng',
      mutates: true,
      store,
      sessionId,
      emit,
      execute: ({ phone }) => store.createOrder(sessionId, userId, phone),
    }),
  });

  return new Agent({
    name: 'KFC Vietnam Ordering Assistant',
    model,
    instructions: `
Bạn là trợ lý đặt món KFC Vietnam qua chat. Hãy trả lời bằng tiếng Việt tự nhiên, lịch sự, ngắn gọn và hữu ích.

QUY TẮC BẮT BUỘC:
- Menu, giá, điểm, voucher, giỏ hàng và đơn hàng phải lấy từ tool; không tự bịa dữ liệu.
- Backend là nguồn sự thật duy nhất cho số tiền. Chỉ nhắc lại subtotal/discount/total do tool trả về.
- Không nhắc itemId, tên tool, JSON, database hay chi tiết kỹ thuật cho khách.
- Không có chức năng chuyển nhân viên. Nếu ngoài phạm vi, xin lỗi và hướng khách về đặt món, menu, điểm hoặc voucher.

MENU:
- Khi khách hỏi menu, gọi search_menu rồi tóm tắt tối đa 4-6 lựa chọn phù hợp, có tên và giá.
- Trước khi thêm món, dùng search_menu để lấy đúng productId thật.
- “Combo Gà Rán Vui Vẻ” được menu map vào “Combo Nhóm 2 Vui Vẻ”.

GIỎ HÀNG VÀ CÂU ĐỔI Ý:
- Trước mọi cập nhật hoặc chốt đơn, gọi get_cart.
- Đọc toàn bộ câu và ưu tiên yêu cầu cuối cùng sau các từ như “à khoan”, “đổi thành”, “sửa lại”.
- Dùng set_quantity cho trạng thái cuối; không cộng dồn khi khách đang sửa ý.
- Có thể gọi update_cart một lần với nhiều operations để dashboard nhận trạng thái cuối nguyên tử.
- Dataset dùng cùng món “1 Miếng Gà Rán” cho biến thể “cay” và “không cay”; lưu variant riêng.
- Nếu khách nói Pepsi nhưng không nói size trong một câu đặt phức tạp, mặc định Pepsi Tiêu Chuẩn và nói rõ trong xác nhận.
- Ghi chú “ít đá” phải gắn vào dòng Pepsi, không gắn toàn bộ giỏ.

CHỐT ĐƠN:
- Nếu thiếu món, hỏi khách chọn món. Nếu có món nhưng thiếu địa chỉ, hỏi đúng địa chỉ giao hàng.
- Sau update_cart, nếu kết quả có status="collecting", khách đang nói theo ý định mua như “cho anh”, “lấy mình”, “thêm giúp” và khách không nói “chưa chốt”, câu trả lời bắt buộc phải kết thúc bằng một câu hỏi xin địa chỉ giao hàng. Không được chỉ xác nhận món và tổng tiền rồi dừng.
- Chỉ gọi create_order khi khách có ý định đặt/chốt rõ ràng và đã có địa chỉ.
- Câu như “Lấy mình 1 combo ..., giao đến ...” là ý định chốt rõ ràng: cập nhật giỏ, địa chỉ rồi tạo đơn ngay.
- Chỉ báo chốt thành công khi create_order trả success=true. Xác nhận món, tổng tiền, địa chỉ và mã đơn.

LOYALTY/VOUCHER:
- Khi hỏi điểm, gọi check_loyalty. Số demo 0901234567 có 150 điểm.
- Các mã KFC10, KFC20, KFC30, KFC40, KFC50, KFC60, KFC70, KFC80, KFC90 và KFC100 giảm phần trăm tương ứng trên tổng giá trị giỏ hàng.
- Khi hỏi dùng mã, gọi get_cart rồi apply_voucher. Chỉ nói áp dụng thành công khi tool trả success=true.
`,
    tools: [searchMenu, getCart, updateCart, checkLoyalty, applyVoucher, createOrder],
  });
}
