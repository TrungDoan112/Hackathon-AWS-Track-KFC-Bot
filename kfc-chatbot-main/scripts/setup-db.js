import 'dotenv/config';
import { config } from '../src/config.js';
import { openDatabase } from '../src/infrastructure/database.js';

const { db, menuCount } = openDatabase({
  databasePath: config.databasePath,
  menuPath: config.menuPath,
});
console.log(`SQLite sẵn sàng tại ${config.databasePath}`);
console.log(`Đã import ${menuCount} món từ kfc_menu.json và seed loyalty/voucher demo.`);
db.close();

