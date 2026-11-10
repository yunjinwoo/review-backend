import express from 'express';
import {
  getGoals, postGoal, putGoal, removeGoal, getLogs, toggleLog, markLog,
  getTodos, postTodo, putTodo, removeTodo,
} from '../controllers/goals.js';

const router = express.Router();

router.get('/goals', getGoals);                 // 목표 목록
router.post('/goals', postGoal);                // 목표 추가
router.put('/goals/:id', putGoal);              // 목표 수정
router.delete('/goals/:id', removeGoal);        // 목표 삭제 (체크 기록도 함께)
router.get('/goal-logs', getLogs);              // ?from=yyyy-MM-dd&to=yyyy-MM-dd
router.post('/goal-logs/toggle', toggleLog);    // { goalId, date } 체크/해제
router.post('/goal-logs/mark', markLog);        // { goalId, date, workoutId } 운동 기록으로 자동 체크
router.get('/todos', getTodos);                 // ?from=yyyy-MM-dd&to=yyyy-MM-dd
router.post('/todos', postTodo);                // { date, title, done?, goalId? } 할 일 추가
router.put('/todos/:id', putTodo);              // 할 일 수정 (완료 체크 포함)
router.delete('/todos/:id', removeTodo);        // 할 일 삭제

export default router;
