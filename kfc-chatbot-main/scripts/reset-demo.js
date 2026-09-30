import 'dotenv/config';
import { config } from '../src/config.js';
import { openDatabase, resetAllDemoData } from '../src/infrastructure/database.js';

const { db } = openDatabase({
  databasePath: config.databasePath,
  menuPath: config.menuPath,
});
resetAllDemoData(db);
console.log('Đã xóa sessions, giỏ hàng, hội thoại và đơn demo. Menu/loyalty/voucher vẫn được giữ.');
db.close();

