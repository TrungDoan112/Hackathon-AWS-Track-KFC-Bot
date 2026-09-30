import 'dotenv/config';
import { createApplication } from './src/server.js';

const application = createApplication();
application.app.listen(application.config.port, () => {
  console.log(`KFC demo đang chạy: http://localhost:${application.config.port}`);
  console.log(`Dashboard: http://localhost:${application.config.port}/dashboard`);
  console.log(`Chat SSE: POST http://localhost:${application.config.port}/api/chat`);
});

