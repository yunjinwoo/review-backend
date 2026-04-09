import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import reviewRoutes from './routes/review.js';

const app = express();
const port = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());

// 라우터 등록
app.use('/api', reviewRoutes);

app.listen(port, () => {
  console.log(`[Server]: 🚀 Backend is running at http://localhost:${port}`);
});
