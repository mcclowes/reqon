/**
 * Webhook Store
 *
 * Stores webhook registrations and received events.
 * Supports both in-memory and file-based persistence.
 */

import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { WebhookRegistration, WebhookEvent } from './types.js';

/**
 * Interface for webhook storage
 */
export interface WebhookStore {
  /** Save a webhook registration */
  saveRegistration(registration: WebhookRegistration): Promise<void>;
  /** Get a registration by ID */
  getRegistration(id: string): Promise<WebhookRegistration | undefined>;
  /** Get a registration by path */
  getRegistrationByPath(path: string): Promise<WebhookRegistration | undefined>;
  /** Delete a registration */
  deleteRegistration(id: string): Promise<void>;
  /** List all registrations */
  listRegistrations(): Promise<WebhookRegistration[]>;
  /** Save a webhook event */
  saveEvent(event: WebhookEvent): Promise<void>;
  /** Get events for a registration */
  getEvents(registrationId: string): Promise<WebhookEvent[]>;
  /** Delete events for a registration */
  deleteEvents(registrationId: string): Promise<void>;
  /** Clean up expired registrations */
  cleanupExpired(): Promise<number>;
}

/**
 * In-memory webhook store
 */
export class MemoryWebhookStore implements WebhookStore {
  private registrations: Map<string, WebhookRegistration> = new Map();
  private events: Map<string, WebhookEvent[]> = new Map();
  private pathIndex: Map<string, string> = new Map(); // path -> registrationId

  async saveRegistration(registration: WebhookRegistration): Promise<void> {
    this.registrations.set(registration.id, registration);
    this.pathIndex.set(registration.path, registration.id);
  }

  async getRegistration(id: string): Promise<WebhookRegistration | undefined> {
    return this.registrations.get(id);
  }

  async getRegistrationByPath(path: string): Promise<WebhookRegistration | undefined> {
    const id = this.pathIndex.get(path);
    if (!id) return undefined;
    return this.registrations.get(id);
  }

  async deleteRegistration(id: string): Promise<void> {
    const reg = this.registrations.get(id);
    if (reg) {
      this.pathIndex.delete(reg.path);
    }
    this.registrations.delete(id);
  }

  async listRegistrations(): Promise<WebhookRegistration[]> {
    return Array.from(this.registrations.values());
  }

  async saveEvent(event: WebhookEvent): Promise<void> {
    const events = this.events.get(event.registrationId) ?? [];
    events.push(event);
    this.events.set(event.registrationId, events);
  }

  async getEvents(registrationId: string): Promise<WebhookEvent[]> {
    return this.events.get(registrationId) ?? [];
  }

  async deleteEvents(registrationId: string): Promise<void> {
    this.events.delete(registrationId);
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date();
    let cleaned = 0;

    for (const [id, reg] of this.registrations) {
      if (reg.expiresAt < now) {
        await this.deleteRegistration(id);
        await this.deleteEvents(id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/**
 * File-based webhook store for persistence across restarts
 */
export class FileWebhookStore implements WebhookStore {
  private baseDir: string;
  private registrationsDir: string;
  private eventsDir: string;
  private initialized = false;

  constructor(baseDir = '.reqon-data/webhooks') {
    this.baseDir = baseDir;
    this.registrationsDir = join(baseDir, 'registrations');
    this.eventsDir = join(baseDir, 'events');
  }

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.registrationsDir, { recursive: true });
    await mkdir(this.eventsDir, { recursive: true });
    this.initialized = true;
  }

  async saveRegistration(registration: WebhookRegistration): Promise<void> {
    await this.ensureInit();
    const filePath = join(this.registrationsDir, `${registration.id}.json`);
    await writeFile(filePath, JSON.stringify(registration, null, 2));
  }

  async getRegistration(id: string): Promise<WebhookRegistration | undefined> {
    await this.ensureInit();
    try {
      const filePath = join(this.registrationsDir, `${id}.json`);
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        expiresAt: new Date(data.expiresAt),
      };
    } catch {
      return undefined;
    }
  }

  async getRegistrationByPath(path: string): Promise<WebhookRegistration | undefined> {
    const registrations = await this.listRegistrations();
    return registrations.find((r) => r.path === path);
  }

  async deleteRegistration(id: string): Promise<void> {
    await this.ensureInit();
    try {
      const filePath = join(this.registrationsDir, `${id}.json`);
      await unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  async listRegistrations(): Promise<WebhookRegistration[]> {
    await this.ensureInit();
    try {
      const files = await readdir(this.registrationsDir);
      const registrations: WebhookRegistration[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const id = file.replace('.json', '');
        const reg = await this.getRegistration(id);
        if (reg) registrations.push(reg);
      }

      return registrations;
    } catch {
      return [];
    }
  }

  async saveEvent(event: WebhookEvent): Promise<void> {
    await this.ensureInit();
    const eventDir = join(this.eventsDir, event.registrationId);
    await mkdir(eventDir, { recursive: true });
    const filePath = join(eventDir, `${event.id}.json`);
    await writeFile(filePath, JSON.stringify(event, null, 2));
  }

  async getEvents(registrationId: string): Promise<WebhookEvent[]> {
    await this.ensureInit();
    try {
      const eventDir = join(this.eventsDir, registrationId);
      const files = await readdir(eventDir);
      const events: WebhookEvent[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = join(eventDir, file);
        const content = await readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        events.push({
          ...data,
          receivedAt: new Date(data.receivedAt),
        });
      }

      return events.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    } catch {
      return [];
    }
  }

  async deleteEvents(registrationId: string): Promise<void> {
    await this.ensureInit();
    try {
      const eventDir = join(this.eventsDir, registrationId);
      const files = await readdir(eventDir);
      for (const file of files) {
        await unlink(join(eventDir, file));
      }
    } catch {
      // Ignore if directory doesn't exist
    }
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date();
    const registrations = await this.listRegistrations();
    let cleaned = 0;

    for (const reg of registrations) {
      if (reg.expiresAt < now) {
        await this.deleteRegistration(reg.id);
        await this.deleteEvents(reg.id);
        cleaned++;
      }
    }

    return cleaned;
  }
}
