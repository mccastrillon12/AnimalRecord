import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

// Module constants identify this process boot, not each request/DI container.
const instanceId = uuidv4();
const startedAt = new Date().toISOString();

@Injectable()
export class AnimalWriteInstance {
  readonly id = instanceId;
  readonly startedAt = startedAt;
}
