/**
 * State management for tracking last reviewed commit
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ReviewState {
  /** Last reviewed Vague commit SHA */
  lastReviewedCommit: string;
  /** Timestamp of last review */
  lastReviewedAt: string;
  /** Vague version at last review */
  vagueVersion?: string;
  /** Whether the last review found changes needed */
  changesNeeded?: boolean;
}

const DEFAULT_STATE_PATH = '.reqon-data/ai-reviews/state.json';

export class ReviewStateStore {
  private statePath: string;

  constructor(statePath: string = DEFAULT_STATE_PATH) {
    this.statePath = statePath;
  }

  /**
   * Load the current review state
   */
  async load(): Promise<ReviewState | null> {
    try {
      const content = await readFile(this.statePath, 'utf-8');
      return JSON.parse(content) as ReviewState;
    } catch {
      return null;
    }
  }

  /**
   * Save the review state
   */
  async save(state: ReviewState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Get the last reviewed commit SHA, if any
   */
  async getLastReviewedCommit(): Promise<string | null> {
    const state = await this.load();
    return state?.lastReviewedCommit ?? null;
  }

  /**
   * Update state after a review
   */
  async updateAfterReview(
    commitSha: string,
    vagueVersion: string | undefined,
    changesNeeded: boolean
  ): Promise<void> {
    await this.save({
      lastReviewedCommit: commitSha,
      lastReviewedAt: new Date().toISOString(),
      vagueVersion,
      changesNeeded,
    });
  }
}
