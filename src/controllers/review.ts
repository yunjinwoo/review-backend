import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

// Initialize the GenAI SDK. 
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {});

export const reviewCode = async (req: Request, res: Response): Promise<void> => {
  try {
    const { code, language } = req.body;

    if (!code) {
      res.status(400).json({ error: '코드가 제공되지 않았습니다.' });
      return;
    }

    const prompt = `
당신은 20년 경력의 시니어 풀스택 소프트웨어 아키텍트이자 깐깐하지만 유익한 코드 리뷰어입니다.
아래 주어진 ${language || '프로그래밍'} 코드를 분석하고 다음 항목을 포함해 리뷰해주세요:
1. 보안성 (Security Vulnerabilities)
2. 유지보수성 (Maintainability & Best Practices)
3. 성능 (Performance Bottlenecks)
4. 종합 의견 및 개선된 코드 조각 제시

[코드 시작]
${code}
[코드 끝]
    `;

    // Call the Gemini API. We are using gemini-2.5-flash as the default model.
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
    });

    res.json({
        success: true,
        review: response.text
    });
  } catch (error: any) {
    console.error('Error during code review:', error);
    res.status(500).json({ error: error.message || '리뷰 생성 중 오류가 발생했습니다.' });
  }
};
