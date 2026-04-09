import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { PrismaClient } from '@prisma/client';

// Initialize the GenAI SDK. 
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {});

const dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== 'undefined' 
  ? process.env.DATABASE_URL.replace(/"/g, '') // 따옴표가 있을 경우 제거
  : 'file:./dev.db';

const prisma = new PrismaClient({ 
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

export const reviewCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, language } = req.body;

    if (!code) {
      res.status(400).json({ error: '코드가 제공되지 않았습니다.' });
      return;
    }

    const prompt = `
당신은 유익한 코드 리뷰어입니다.
아래 주어진 ${language || '프로그래밍'} 코드를 분석하고 다음 항목을 포함해 리뷰해주세요:
1. 보안성 (Security Vulnerabilities)
2. 유지보수성 (Maintainability & Best Practices)
3. 성능 (Performance Bottlenecks)
4. 종합 의견 및 개선된 코드 조각 제시

[코드 시작]
${code}
[코드 끝]
    `;
    // ==========================================
    // 1. 비용 최적화: 캐싱 (동일한 코드 중복 요청 방지)
    // ==========================================
    try {
      const existingReview = await prisma.review.findFirst({
        where: {
          originalCode: code,
        }
      });

      if (existingReview) {
        console.log('✅ 캐시 히트! 기존 DB에 저장된 리뷰를 반환합니다. (비용 0원)');
        res.json({
          success: true,
          review: existingReview.botReview,
          id: existingReview.id,
          isCached: true
        });
        return; 
      }
    } catch (cacheError) {
      console.warn('캐시 조회 실패:', cacheError);
      // DB 접속 실패 시, 캐시 조회를 건너뛰고 바로 진행하도록 합니다.
    }

    // ==========================================
    // 2. 비용 최적화: 모의 테스트 모드 (개발 중 API 호출 제한)
    // ==========================================
    if (process.env.USE_MOCK_AI === 'true') {
      console.log('⚠️ [Mock 모드] API가 호출되지 않고 임시 텍스트가 반환됩니다. (비용 0원)');
      
      const mockReview = `
> **[테스트 모드 (Mock Mode) 작동 중]**
> 실제 Gemini API가 호출되지 않았으며 요금이 발생하지 않았습니다.
> 백엔드 \`.env\` 파일에서 \`USE_MOCK_AI=true\` 설정을 지우거나 \`false\`로 바꿔야 실제 AI가 작동합니다!

### 1. 보안성 (Security)
- (Mock) 프론트엔드에서 코드를 넘길 때 크기 제한이 없으면 서버가 죽을 수 있습니다.

### 2. 유지보수성 (Maintainability)
- (Mock) 로직이 잘 분리되어 있습니다.

### 3. 성능 (Performance)
- (Mock) DB 캐싱 로직이 추가되었습니다.
      `.trim();

      try {
        const savedMock = await prisma.review.create({
          data: {
            language: language || 'unknown',
            originalCode: code,
            botReview: mockReview,
          }
        });

        res.json({
          success: true,
          review: mockReview,
          id: savedMock.id
        });
      } catch (dbError) {
        // DB 저장이 실패해도 Mock 결과를 띄우기 위함
        res.json({
          success: true,
          review: mockReview + '\n\n*(주의: DB 연결 오류로 이 내역은 저장되지 않았습니다.)*'
        });
      }
      return; 
    }

    // 장애 조치(Fault Tolerance) - 최대 3회 재시도 및 모델 폴백 전략
    let response;
    let lastError: any;
    const defaultModels = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let retryCount = 0;
    const MAX_RETRIES = 3;

    while (retryCount < MAX_RETRIES && !response) {
      for (const modelName of defaultModels) {
        try {
          // Call the Gemini API
          response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
          });
          break; // 해당 모델로 성공하면 for문 탈출
        } catch (error: any) {
          lastError = error;
          const errMsg = error.message || '';

          // 사용량 폭주(503) 리밋(429) 에러인 경우 다른 모델이나 다음 재시도로 넘어감
          if (errMsg.includes('high demand') || errMsg.includes('503') || errMsg.includes('429')) {
            console.warn(`⏳ [경고] ${modelName} 모델 사용량 폭주. 다음 대안을 찾습니다...`);
            continue;
          } else {
            // 다른 치명적 에러라면 즉시 멈춤
            throw error;
          }
        }
      }

      // 모든 모델 후보군을 돌았는데도 실패했다면 잠깐 대기 후 재시도 (Exponential Backoff)
      if (!response) {
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          const delay = 1000 * Math.pow(2, retryCount); // 2초 -> 4초 대기
          console.log(`⏱️ API 호출 재시도 전 ${delay}ms 대기 중... (시도: ${retryCount}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (!response) {
      throw new Error('AI 모델의 사용량이 너무 많아 모든 재시도에 실패했습니다. 유료 티어를 사용하시거나 잠시 후 다시 시도해 주세요.');
    }

    const botReview = response.text || '리뷰를 생성하지 못했습니다.';

    // DB에 데이터 저장
    const savedReview = await prisma.review.create({
      data: {
        language: language || 'unknown',
        originalCode: code,
        botReview: botReview,
      }
    });

    res.json({
      success: true,
      review: botReview,
      id: savedReview.id
    });
  } catch (error: any) {
    console.error('Error during code review:', error);
    const errorMessage = error.message || '알 수 없는 오류가 발생했습니다.';
    const botReviewErrorMsg = `> **[서버 오류 발생]** \n\n리뷰를 생성하는 중 백엔드에서 오류가 발생했습니다.\n\n\`\`\`text\n${errorMessage}\n\`\`\``;

    // 만약 DB 자체의 문제(url_invalid 등)가 아니라 일반 API 에러라면 이 내역도 히스토리에 남김
    try {
      if (!errorMessage.includes('URL_INVALID') && !errorMessage.includes('Prisma')) {
        const errorRecord = await prisma.review.create({
          data: {
             language: language || 'error',
             originalCode: code,
             botReview: botReviewErrorMsg,
          }
        });
        
        // 에러 상황이더라도 히스토리를 띄워주기 위해 200 응답을 주고 결과에 에러 내용을 담아 넘길 수 있지만, 
        // 기존 프론트엔드 호환을 위해 에러 상태로 넘깁니다.
      }
    } catch (dbError) {
      console.error('에러 내역을 DB에 저장하는 데에도 실패했습니다:', dbError);
    }

    res.status(500).json({ error: errorMessage, review: botReviewErrorMsg });
  }
};

/**
 * 저장된 리뷰 목록을 조회 (최신순)
 */
export const getReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const reviews = await prisma.review.findMany({
      select: {
        id: true,
        language: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      reviews
    });
  } catch (error: any) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ error: '리뷰 목록을 불러오는 중 오류가 발생했습니다.' });
  }
};

/**
 * 특정 리뷰 상세 조회
 */
export const getReviewById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const reviewId = parseInt(id, 10);

    if (isNaN(reviewId)) {
      res.status(400).json({ error: '유효하지 않은 리뷰 ID입니다.' });
      return;
    }

    const review = await prisma.review.findUnique({
      where: { id: reviewId }
    });

    if (!review) {
      res.status(404).json({ error: '해당 리뷰를 찾을 수 없습니다.' });
      return;
    }

    res.json({
      success: true,
      review
    });
  } catch (error: any) {
    console.error('Error fetching review by ID:', error);
    res.status(500).json({ error: '리뷰 상세 조회 중 오류가 발생했습니다.' });
  }
};
