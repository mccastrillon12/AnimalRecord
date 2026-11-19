import { Inject, Injectable } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { InvalidArgumentError } from '../../shared/domain/errors/InvalidArgumentError';
import {
  TransferRecipientSearch,
  TransferRecipientSearchBy,
} from '../domain/transfer-recipient-search';

@Injectable()
export class SearchTransferRecipients {
  constructor(
    @Inject('TransferRecipientSearch')
    private readonly repository: TransferRecipientSearch,
  ) {}

  async run(
    actorId: string,
    query: string,
    searchBy = TransferRecipientSearchBy.Name,
    limit = 20,
    cursor?: string,
  ) {
    if (!Object.values(TransferRecipientSearchBy).includes(searchBy)) {
      throw new InvalidArgumentError('Invalid recipient search type');
    }
    const normalized = query.trim().replace(/\s+/g, ' ');
    if (
      normalized.length < 2 ||
      normalized.length > 100 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    ) {
      throw new InvalidArgumentError(
        'Use 2-100 characters and a limit between 1 and 50',
      );
    }
    let afterId: string | undefined;
    if (cursor) {
      afterId = Buffer.from(cursor, 'base64url').toString('utf8');
      if (
        !isUuid(afterId) ||
        Buffer.from(afterId).toString('base64url') !== cursor
      ) {
        throw new InvalidArgumentError('Invalid recipient cursor');
      }
    }
    const search =
      searchBy === TransferRecipientSearchBy.Identification
        ? this.repository.searchByIdentification.bind(this.repository)
        : this.repository.searchByName.bind(this.repository);
    const matches = await search(normalized, actorId, limit + 1, afterId);
    const items = matches.slice(0, limit);
    const nextCursor =
      matches.length > limit
        ? Buffer.from(items[items.length - 1].id).toString('base64url')
        : undefined;
    return { items, nextCursor };
  }
}
