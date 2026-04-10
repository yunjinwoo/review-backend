// src/server.ts
import "dotenv/config";
import express2 from "express";
import cors from "cors";

// src/routes/review.ts
import express from "express";

// src/controllers/review.ts
import { GoogleGenAI } from "@google/genai";
import { PrismaClient } from "@prisma/client";
var ai = new GoogleGenAI(process.env.GEMINI_API_KEY ? { apiKey: process.env.GEMINI_API_KEY } : {});
var dbUrl = process.env.DATABASE_URL && process.env.DATABASE_URL !== "undefined" ? process.env.DATABASE_URL.replace(/"/g, "") : "file:./dev.db";
var prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});
var reviewCode = async (req, res) => {
  try {
    const { code: code2, language: language2 } = req.body;
    if (!code2) {
      res.status(400).json({ error: "\uCF54\uB4DC\uAC00 \uC81C\uACF5\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4." });
      return;
    }
    const prompt = `
\uB2F9\uC2E0\uC740 \uC720\uC775\uD55C \uCF54\uB4DC \uB9AC\uBDF0\uC5B4\uC785\uB2C8\uB2E4.
\uC544\uB798 \uC8FC\uC5B4\uC9C4 ${language2 || "\uD504\uB85C\uADF8\uB798\uBC0D"} \uCF54\uB4DC\uB97C \uBD84\uC11D\uD558\uACE0 \uB2E4\uC74C \uD56D\uBAA9\uC744 \uD3EC\uD568\uD574 \uB9AC\uBDF0\uD574\uC8FC\uC138\uC694:
1. \uBCF4\uC548\uC131 (Security Vulnerabilities)
2. \uC720\uC9C0\uBCF4\uC218\uC131 (Maintainability & Best Practices)
3. \uC131\uB2A5 (Performance Bottlenecks)
4. \uC885\uD569 \uC758\uACAC \uBC0F \uAC1C\uC120\uB41C \uCF54\uB4DC \uC870\uAC01 \uC81C\uC2DC

[\uCF54\uB4DC \uC2DC\uC791]
${code2}
[\uCF54\uB4DC \uB05D]
    `;
    try {
      const existingReview = await prisma.review.findFirst({
        where: {
          originalCode: code2
        }
      });
      if (existingReview) {
        console.log("\u2705 \uCE90\uC2DC \uD788\uD2B8! \uAE30\uC874 DB\uC5D0 \uC800\uC7A5\uB41C \uB9AC\uBDF0\uB97C \uBC18\uD658\uD569\uB2C8\uB2E4. (\uBE44\uC6A9 0\uC6D0)");
        res.json({
          success: true,
          review: existingReview.botReview,
          id: existingReview.id,
          isCached: true
        });
        return;
      }
    } catch (cacheError) {
      console.warn("\uCE90\uC2DC \uC870\uD68C \uC2E4\uD328:", cacheError);
    }
    if (process.env.USE_MOCK_AI === "true") {
      console.log("\u26A0\uFE0F [Mock \uBAA8\uB4DC] API\uAC00 \uD638\uCD9C\uB418\uC9C0 \uC54A\uACE0 \uC784\uC2DC \uD14D\uC2A4\uD2B8\uAC00 \uBC18\uD658\uB429\uB2C8\uB2E4. (\uBE44\uC6A9 0\uC6D0)");
      const mockReview = `
> **[\uD14C\uC2A4\uD2B8 \uBAA8\uB4DC (Mock Mode) \uC791\uB3D9 \uC911]**
> \uC2E4\uC81C Gemini API\uAC00 \uD638\uCD9C\uB418\uC9C0 \uC54A\uC558\uC73C\uBA70 \uC694\uAE08\uC774 \uBC1C\uC0DD\uD558\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.
> \uBC31\uC5D4\uB4DC \`.env\` \uD30C\uC77C\uC5D0\uC11C \`USE_MOCK_AI=true\` \uC124\uC815\uC744 \uC9C0\uC6B0\uAC70\uB098 \`false\`\uB85C \uBC14\uAFD4\uC57C \uC2E4\uC81C AI\uAC00 \uC791\uB3D9\uD569\uB2C8\uB2E4!

### 1. \uBCF4\uC548\uC131 (Security)
- (Mock) \uD504\uB860\uD2B8\uC5D4\uB4DC\uC5D0\uC11C \uCF54\uB4DC\uB97C \uB118\uAE38 \uB54C \uD06C\uAE30 \uC81C\uD55C\uC774 \uC5C6\uC73C\uBA74 \uC11C\uBC84\uAC00 \uC8FD\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.

### 2. \uC720\uC9C0\uBCF4\uC218\uC131 (Maintainability)
- (Mock) \uB85C\uC9C1\uC774 \uC798 \uBD84\uB9AC\uB418\uC5B4 \uC788\uC2B5\uB2C8\uB2E4.

### 3. \uC131\uB2A5 (Performance)
- (Mock) DB \uCE90\uC2F1 \uB85C\uC9C1\uC774 \uCD94\uAC00\uB418\uC5C8\uC2B5\uB2C8\uB2E4.
      `.trim();
      try {
        const savedMock = await prisma.review.create({
          data: {
            language: language2 || "unknown",
            originalCode: code2,
            botReview: mockReview
          }
        });
        res.json({
          success: true,
          review: mockReview,
          id: savedMock.id
        });
      } catch (dbError) {
        res.json({
          success: true,
          review: mockReview + "\n\n*(\uC8FC\uC758: DB \uC5F0\uACB0 \uC624\uB958\uB85C \uC774 \uB0B4\uC5ED\uC740 \uC800\uC7A5\uB418\uC9C0 \uC54A\uC558\uC2B5\uB2C8\uB2E4.)*"
        });
      }
      return;
    }
    let response;
    let lastError;
    const defaultModels = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
    let retryCount = 0;
    const MAX_RETRIES = 3;
    while (retryCount < MAX_RETRIES && !response) {
      for (const modelName of defaultModels) {
        try {
          response = await ai.models.generateContent({
            model: modelName,
            contents: prompt
          });
          break;
        } catch (error) {
          lastError = error;
          const errMsg = error.message || "";
          if (errMsg.includes("high demand") || errMsg.includes("503") || errMsg.includes("429")) {
            console.warn(`\u23F3 [\uACBD\uACE0] ${modelName} \uBAA8\uB378 \uC0AC\uC6A9\uB7C9 \uD3ED\uC8FC. \uB2E4\uC74C \uB300\uC548\uC744 \uCC3E\uC2B5\uB2C8\uB2E4...`);
            continue;
          } else {
            throw error;
          }
        }
      }
      if (!response) {
        retryCount++;
        if (retryCount < MAX_RETRIES) {
          const delay = 1e3 * Math.pow(2, retryCount);
          console.log(`\u23F1\uFE0F API \uD638\uCD9C \uC7AC\uC2DC\uB3C4 \uC804 ${delay}ms \uB300\uAE30 \uC911... (\uC2DC\uB3C4: ${retryCount}/${MAX_RETRIES})`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    if (!response) {
      throw new Error("AI \uBAA8\uB378\uC758 \uC0AC\uC6A9\uB7C9\uC774 \uB108\uBB34 \uB9CE\uC544 \uBAA8\uB4E0 \uC7AC\uC2DC\uB3C4\uC5D0 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4. \uC720\uB8CC \uD2F0\uC5B4\uB97C \uC0AC\uC6A9\uD558\uC2DC\uAC70\uB098 \uC7A0\uC2DC \uD6C4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.");
    }
    const botReview = response.text || "\uB9AC\uBDF0\uB97C \uC0DD\uC131\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.";
    const savedReview = await prisma.review.create({
      data: {
        language: language2 || "unknown",
        originalCode: code2,
        botReview
      }
    });
    res.json({
      success: true,
      review: botReview,
      id: savedReview.id
    });
  } catch (error) {
    console.error("Error during code review:", error);
    const errorMessage = error.message || "\uC54C \uC218 \uC5C6\uB294 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.";
    const botReviewErrorMsg = `> **[\uC11C\uBC84 \uC624\uB958 \uBC1C\uC0DD]** 

\uB9AC\uBDF0\uB97C \uC0DD\uC131\uD558\uB294 \uC911 \uBC31\uC5D4\uB4DC\uC5D0\uC11C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4.

\`\`\`text
${errorMessage}
\`\`\``;
    try {
      if (!errorMessage.includes("URL_INVALID") && !errorMessage.includes("Prisma")) {
        const errorRecord = await prisma.review.create({
          data: {
            language: language || "error",
            originalCode: code,
            botReview: botReviewErrorMsg
          }
        });
      }
    } catch (dbError) {
      console.error("\uC5D0\uB7EC \uB0B4\uC5ED\uC744 DB\uC5D0 \uC800\uC7A5\uD558\uB294 \uB370\uC5D0\uB3C4 \uC2E4\uD328\uD588\uC2B5\uB2C8\uB2E4:", dbError);
    }
    res.status(500).json({ error: errorMessage, review: botReviewErrorMsg });
  }
};
var getReviews = async (req, res) => {
  try {
    const reviews = await prisma.review.findMany({
      select: {
        id: true,
        language: true,
        createdAt: true
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    res.json({
      success: true,
      reviews
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ error: "\uB9AC\uBDF0 \uBAA9\uB85D\uC744 \uBD88\uB7EC\uC624\uB294 \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4." });
  }
};
var getReviewById = async (req, res) => {
  try {
    const { id } = req.params;
    const reviewId = parseInt(id, 10);
    if (isNaN(reviewId)) {
      res.status(400).json({ error: "\uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 \uB9AC\uBDF0 ID\uC785\uB2C8\uB2E4." });
      return;
    }
    const review = await prisma.review.findUnique({
      where: { id: reviewId }
    });
    if (!review) {
      res.status(404).json({ error: "\uD574\uB2F9 \uB9AC\uBDF0\uB97C \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4." });
      return;
    }
    res.json({
      success: true,
      review
    });
  } catch (error) {
    console.error("Error fetching review by ID:", error);
    res.status(500).json({ error: "\uB9AC\uBDF0 \uC0C1\uC138 \uC870\uD68C \uC911 \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4." });
  }
};

// src/routes/review.ts
var router = express.Router();
router.post("/review", reviewCode);
router.get("/reviews", getReviews);
router.get("/reviews/:id", getReviewById);
var review_default = router;

// src/server.ts
var app = express2();
var port = process.env.PORT || 5050;
app.use(cors());
app.use(express2.json());
app.use("/api", review_default);
app.listen(port, () => {
  console.log(`[Server]: \u{1F680} Backend is running at http://localhost:${port}`);
});
