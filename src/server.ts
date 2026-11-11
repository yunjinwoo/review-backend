import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import reviewRoutes from './routes/review.js';
import goalRoutes from './routes/goals.js';
import calendarRoutes from './routes/calendar.js';
import { ensureGoalTables } from './services/goals.js';

const app = express();
const port = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

// 라우터 등록
app.use('/api', reviewRoutes);
app.use('/api', goalRoutes); // 주간 운동 목표 (gemini_flutter /#/goals)
app.use('/api', calendarRoutes); // 다른 달력 구독용 .ics

// 목표 테이블을 미리 만들어 둔다. 실패해도 리뷰 기능은 그대로 돌아가고, 목표 API 첫 요청에서 다시 시도한다.
ensureGoalTables().catch((e) => console.error('[goals] 테이블 준비 실패:', e));

app.listen(port, () => {
  console.log(`[Server]: 🚀 Backend is running at http://localhost:${port}`);
});
