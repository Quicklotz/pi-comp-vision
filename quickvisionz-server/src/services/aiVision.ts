import OpenAI from 'openai';
import { config } from '../config.js';

interface AiVisionResult {
  title: string;
  brand?: string;
  model?: string;
  category?: string;
  condition?: string;
  confidence: number;
}

export class AiVision {
  private client: OpenAI | null = null;

  private getClient(): OpenAI | null {
    if (!config.openai.apiKey) return null;
    if (!this.client) {
      this.client = new OpenAI({ apiKey: config.openai.apiKey });
    }
    return this.client;
  }

  async identify(imageBase64: string): Promise<AiVisionResult | null> {
    const client = this.getClient();
    if (!client) {
      console.warn('[AiVision] OpenAI not configured');
      return null;
    }

    try {
      const response = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a product identification expert. Given an image of a product, identify it precisely. Return JSON only.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Identify this product. Return JSON with fields: title, brand, model, category, condition (new/like_new/good/fair/poor), confidence (0-1). JSON only, no markdown.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                  detail: 'low',
                },
              },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      const cleaned = content.replace(/```json\n?|\n?```/g, '').trim();
      return JSON.parse(cleaned) as AiVisionResult;
    } catch (err) {
      console.error('[AiVision] Error:', err);
      return null;
    }
  }
}
