interface GradeResult {
  grade: string;
  route: string;
  confidence: number;
  notes: string;
}

const ROUTE_MAP: Record<string, string> = {
  A: 'LIST_PRIME',
  B: 'LIST_STANDARD',
  C: 'REFURBISH',
  D: 'PARTS',
  F: 'RECYCLE',
};

export class GradeEngine {
  grade(className: string, detectionConfidence: number, enrichment: any): GradeResult {
    let score = 50; // Base score
    const notes: string[] = [];

    // Detection confidence factor
    if (detectionConfidence > 0.8) {
      score += 10;
      notes.push('High detection confidence');
    } else if (detectionConfidence < 0.5) {
      score -= 10;
      notes.push('Low detection confidence');
    }

    // Product identification bonus
    if (enrichment?.title) {
      score += 15;
      notes.push('Product identified');
    }

    // Brand recognition
    if (enrichment?.brand) {
      score += 10;
      notes.push(`Brand: ${enrichment.brand}`);
    }

    // Market value factor
    if (enrichment?.estimatedValue) {
      if (enrichment.estimatedValue > 100) {
        score += 15;
        notes.push(`High value: $${enrichment.estimatedValue.toFixed(2)}`);
      } else if (enrichment.estimatedValue > 30) {
        score += 5;
        notes.push(`Medium value: $${enrichment.estimatedValue.toFixed(2)}`);
      } else {
        score -= 5;
        notes.push(`Low value: $${enrichment.estimatedValue.toFixed(2)}`);
      }
    }

    // Marketplace comps availability
    if (enrichment?.comps?.length > 3) {
      score += 5;
      notes.push(`${enrichment.comps.length} marketplace comps found`);
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Map score to grade
    let grade: string;
    if (score >= 80) grade = 'A';
    else if (score >= 65) grade = 'B';
    else if (score >= 45) grade = 'C';
    else if (score >= 25) grade = 'D';
    else grade = 'F';

    return {
      grade,
      route: ROUTE_MAP[grade] || 'REVIEW',
      confidence: score / 100,
      notes: notes.join('; '),
    };
  }
}
