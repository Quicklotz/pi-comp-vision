import fs from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

export class ImageStorage {
  private baseDir: string;

  constructor() {
    this.baseDir = config.uploads.dir;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'detections'), { recursive: true });
    await fs.mkdir(path.join(this.baseDir, 'products'), { recursive: true });
  }

  async saveDetectionImage(detectionId: string, base64Image: string): Promise<string> {
    await this.init();
    const filename = `${detectionId}.jpg`;
    const filepath = path.join(this.baseDir, 'detections', filename);

    const buffer = Buffer.from(base64Image, 'base64');
    await fs.writeFile(filepath, buffer);

    return `/api/images/detections/${filename}`;
  }

  async saveProductImage(productId: string, base64Image: string): Promise<string> {
    await this.init();
    const filename = `${productId}.jpg`;
    const filepath = path.join(this.baseDir, 'products', filename);

    const buffer = Buffer.from(base64Image, 'base64');
    await fs.writeFile(filepath, buffer);

    return `/api/images/products/${filename}`;
  }

  getFilePath(category: string, filename: string): string {
    return path.join(this.baseDir, category, filename);
  }
}
